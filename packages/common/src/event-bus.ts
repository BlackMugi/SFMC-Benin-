import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import * as amqp from 'amqplib';
import { DataSource } from 'typeorm';
import { env } from './config';
import { runWithContext } from './context';
import { contractViolations } from './contracts';
import { EventEnvelope, EventType } from './events';
import { MetricsService } from './metrics';
import { SFMC_OPTIONS, SfmcOptions } from './options';

export const EXCHANGE = 'sfmc.events';
export const DLX = 'sfmc.dlx';
const MAX_RETRIES = 3;

type Handler = (event: EventEnvelope<any>) => Promise<void>;
interface Subscription { queue: string; types: EventType[]; handler: Handler }

/**
 * Bus d'événements RabbitMQ (exchange topic, clé de routage = type d'événement).
 * - une file durable par (service, usage) : plusieurs instances = consommateurs concurrents ;
 * - ré-essais bornés puis dead-letter (sfmc.dead-letters) ;
 * - correlation-id propagé dans l'enveloppe et restauré dans le contexte du consommateur ;
 * - publication uniquement via l'Outbox (transactionnelle) ; réception dédupliquée par identifiant d'événement
 *   (table processed_events) : un événement livré plusieurs fois n'est traité qu'une fois par file.
 */
@Injectable()
export class EventBus implements OnApplicationShutdown {
  private readonly log = new Logger('EventBus');
  private conn?: amqp.Connection;
  private channel?: amqp.ConfirmChannel;
  private readonly subscriptions: Subscription[] = [];
  private closing = false;
  private connecting?: Promise<void>;

  private ds?: DataSource | null;

  constructor(
    @Inject(SFMC_OPTIONS) private readonly options: SfmcOptions,
    private readonly metrics: MetricsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  isConnected() {
    return !!this.channel;
  }

  async connect(): Promise<void> {
    this.connecting ??= this.connectLoop();
    return this.connecting;
  }

  private async connectLoop(): Promise<void> {
    const url = env('RABBITMQ_URL');
    for (let attempt = 1; !this.closing; attempt++) {
      try {
        this.conn = (await amqp.connect(url)) as unknown as amqp.Connection;
        this.conn.on('error', (e: Error) => this.log.error(`Erreur RabbitMQ : ${e.message}`));
        this.conn.on('close', () => {
          this.channel = undefined;
          if (this.closing) return;
          this.log.warn('Connexion RabbitMQ perdue, reconnexion...');
          this.connecting = undefined;
          setTimeout(() => void this.connect(), 2000);
        });
        const ch = await (this.conn as any).createConfirmChannel();
        await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
        await ch.assertExchange(DLX, 'fanout', { durable: true });
        await ch.assertQueue('sfmc.dead-letters', { durable: true });
        await ch.bindQueue('sfmc.dead-letters', DLX, '');
        ch.on('error', (e: Error) => this.log.error(`Erreur canal : ${e.message}`));
        this.channel = ch;
        for (const s of this.subscriptions) await this.bindConsumer(s);
        this.log.log('Connecté à RabbitMQ');
        return;
      } catch (e) {
        if (attempt >= 60) throw e;
        this.log.warn(`RabbitMQ indisponible (${(e as Error).message}), essai ${attempt}/60`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  /**
   * Publie une enveloppe déjà construite (appelé par le relais de l'Outbox). Échoue immédiatement si le broker est
   * indisponible : l'événement reste dans l'outbox et sera ré-essayé, sans bloquer la transaction du relais.
   */
  async publishEnvelope(envelope: EventEnvelope): Promise<void> {
    const ch = this.channel;
    if (!ch) {
      void this.connect().catch(() => undefined);
      throw new Error('RabbitMQ non connecté');
    }
    await new Promise<void>((resolve, reject) => {
      ch.publish(
        EXCHANGE,
        envelope.type,
        Buffer.from(JSON.stringify(envelope)),
        { persistent: true, contentType: 'application/json', messageId: envelope.id, correlationId: envelope.correlationId, type: envelope.type },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    this.metrics.eventsPublished.inc({ type: envelope.type });
    this.log.log(`Événement publié : ${envelope.type}`);
  }

  /** Déclare une file et la lie aux types demandés. À appeler depuis onModuleInit. */
  async subscribe(queue: string, types: EventType[], handler: Handler): Promise<void> {
    const sub = { queue, types, handler };
    this.subscriptions.push(sub);
    await this.connect();
    await this.bindConsumer(sub);
  }

  private async bindConsumer({ queue, types, handler }: Subscription) {
    const ch = this.channel!;
    await ch.assertQueue(queue, { durable: true, arguments: { 'x-dead-letter-exchange': DLX } });
    for (const t of types) await ch.bindQueue(queue, EXCHANGE, t);
    await ch.prefetch(10);
    await ch.consume(queue, (msg) => {
      if (!msg) return;
      void this.handle(queue, msg, handler);
    });
  }

  private async handle(queue: string, msg: amqp.ConsumeMessage, handler: Handler) {
    const ch = this.channel!;
    let event: EventEnvelope;
    try {
      event = JSON.parse(msg.content.toString());
    } catch {
      ch.nack(msg, false, false);
      return;
    }
    const violations = contractViolations(event.type, event.payload);
    if (violations.length) {
      // Message non conforme : inutile de le ré-essayer, il part directement en dead-letter pour analyse
      this.log.error(`Contrat ${event.type} non respecté (${event.source ?? 'source inconnue'}) : ${violations.join(' ; ')}`);
      this.metrics.eventsFailed.inc({ type: event.type });
      ch.nack(msg, false, false);
      return;
    }
    await runWithContext(event.correlationId, async () => {
      try {
        if (await this.alreadyProcessed(event.id, queue)) {
          this.log.log(`Doublon ignoré : ${event.type} ${event.id}`);
          ch.ack(msg);
          return;
        }
        await handler(event);
        await this.markProcessed(event.id, queue);
        this.metrics.eventsConsumed.inc({ type: event.type });
        ch.ack(msg);
      } catch (e) {
        const retries = Number(msg.properties.headers?.['x-retries'] ?? 0);
        this.log.error(`Échec du traitement de ${event.type} (essai ${retries + 1}/${MAX_RETRIES}) : ${(e as Error).message}`);
        if (retries + 1 < MAX_RETRIES) {
          // ré-essai différé : republie sur la file d'origine
          ch.ack(msg);
          setTimeout(() => {
            this.channel?.sendToQueue(queue, msg.content, { persistent: true, headers: { ...msg.properties.headers, 'x-retries': retries + 1 }, correlationId: msg.properties.correlationId, messageId: msg.properties.messageId });
          }, 1000 * (retries + 1));
        } else {
          this.metrics.eventsFailed.inc({ type: event.type });
          ch.nack(msg, false, false); // -> dead-letter
        }
      }
    });
  }

  private dataSource(): DataSource | null {
    if (this.ds === undefined) {
      try {
        this.ds = this.moduleRef.get(DataSource, { strict: false });
      } catch {
        this.ds = null; // service sans base : pas de déduplication persistante
      }
    }
    return this.ds;
  }

  private async alreadyProcessed(eventId: string, consumer: string): Promise<boolean> {
    const ds = this.dataSource();
    if (!ds || !eventId) return false;
    const rows = await ds.query('SELECT 1 FROM processed_events WHERE event_id = $1 AND consumer = $2', [eventId, consumer]);
    return rows.length > 0;
  }

  private async markProcessed(eventId: string, consumer: string) {
    const ds = this.dataSource();
    if (!ds || !eventId) return;
    await ds.query('INSERT INTO processed_events (event_id, consumer) VALUES ($1, $2) ON CONFLICT DO NOTHING', [eventId, consumer]);
  }

  async onApplicationShutdown() {
    this.closing = true;
    try {
      await this.channel?.close();
      await (this.conn as any)?.close();
    } catch {
      /* déjà fermé */
    }
  }
}
