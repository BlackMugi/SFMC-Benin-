import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { Column, CreateDateColumn, DataSource, Entity, EntityManager, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import { envInt } from './config';
import { getCorrelationId } from './context';
import { EventBus } from './event-bus';
import { EventEnvelope, EventType } from './events';
import { SFMC_OPTIONS, SfmcOptions } from './options';

/** Événement à publier, écrit dans la même transaction que le changement d'état qui le produit. */
@Entity('outbox')
@Index('IDX_outbox_unpublished', ['seq'], { where: 'published_at IS NULL' })
export class OutboxEvent {
  /** Ordre de publication */
  @PrimaryGeneratedColumn({ type: 'bigint' })
  seq: string;

  /** Identifiant de l'enveloppe : sert de clé de déduplication côté consommateurs */
  @Column({ name: 'event_id', type: 'uuid', unique: true })
  eventId: string;

  @Column()
  type: string;

  @Column({ type: 'jsonb' })
  payload: unknown;

  @Column({ name: 'correlation_id', type: 'varchar' })
  correlationId: string;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'last_error', type: 'varchar', nullable: true })
  lastError: string | null;
}

/** Événements déjà traités par un consommateur (déduplication des livraisons multiples). */
@Entity('processed_events')
export class ProcessedEvent {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @PrimaryColumn()
  consumer: string;

  @CreateDateColumn({ name: 'processed_at', type: 'timestamptz' })
  processedAt: Date;
}

/** Entités à ajouter au TypeOrmModule.forFeature() des services qui publient ou consomment des événements. */
export const OUTBOX_ENTITIES = [OutboxEvent, ProcessedEvent];

export interface PendingEvent {
  type: EventType;
  payload: unknown;
}

/**
 * Outbox transactionnelle : un changement d'état et les événements qu'il produit sont enregistrés atomiquement,
 * puis un relais les publie sur RabbitMQ (au moins une fois, dans l'ordre d'écriture, avec ré-essais).
 * Plusieurs répliques peuvent relayer en parallèle sans doublon de traitement (FOR UPDATE SKIP LOCKED).
 */
@Injectable()
export class Outbox implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('Outbox');
  private ds?: DataSource;
  private timer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;
  private relaying?: Promise<unknown>;
  private again = false;

  constructor(
    @Inject(SFMC_OPTIONS) private readonly options: SfmcOptions,
    private readonly moduleRef: ModuleRef,
    private readonly bus: EventBus,
  ) {}

  onModuleInit() {
    if (this.options.events === false) return;
    this.timer = setInterval(() => this.nudge(), envInt('OUTBOX_POLL_MS', 1000));
    this.cleanupTimer = setInterval(() => void this.cleanup(), 3_600_000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  private dataSource(): DataSource {
    this.ds ??= this.moduleRef.get(DataSource, { strict: false });
    return this.ds;
  }

  /**
   * Exécute fn dans une transaction ; les événements ajoutés à `events` sont écrits dans l'outbox avant le commit.
   * Si la transaction échoue, aucun événement n'est publié ; si elle réussit, aucun n'est perdu.
   */
  async run<T>(fn: (m: EntityManager, events: PendingEvent[]) => Promise<T>): Promise<T> {
    const result = await this.dataSource().transaction(async (m) => {
      const events: PendingEvent[] = [];
      const value = await fn(m, events);
      await this.enqueue(m, events);
      return value;
    });
    this.nudge();
    return result;
  }

  /** Ajoute des événements à l'outbox dans une transaction déjà ouverte par l'appelant. */
  async enqueue(m: EntityManager, events: PendingEvent[]) {
    if (!events.length) return;
    const correlationId = getCorrelationId() ?? randomUUID();
    const now = Date.now();
    await m.insert(
      OutboxEvent,
      events.map((e, i) => ({ eventId: randomUUID(), type: e.type, payload: e.payload as object, correlationId, occurredAt: new Date(now + i), publishedAt: null })),
    );
  }

  /** Déclenche un passage du relais (sans attendre) ; les appels concurrents sont regroupés. */
  nudge() {
    if (this.relaying) {
      this.again = true;
      return;
    }
    this.relaying = this.relay()
      .catch((e) => this.log.error(`Relais de l'outbox : ${(e as Error).message}`))
      .finally(() => {
        this.relaying = undefined;
        if (this.again) {
          this.again = false;
          this.nudge();
        }
      });
  }

  /** Publie les événements en attente par lots ; s'arrête au premier échec (ré-essai au prochain passage). */
  async relay(): Promise<number> {
    let total = 0;
    for (;;) {
      const sent = await this.dataSource().transaction(async (m) => {
        const rows: OutboxEvent[] = await m
          .createQueryBuilder(OutboxEvent, 'o')
          .where('o.published_at IS NULL')
          .orderBy('o.seq', 'ASC')
          .limit(100)
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .getMany();
        let ok = 0;
        for (const row of rows) {
          const envelope: EventEnvelope = {
            id: row.eventId,
            type: row.type as EventType,
            occurredAt: row.occurredAt.toISOString(),
            correlationId: row.correlationId,
            source: this.options.serviceName,
            payload: row.payload,
          };
          try {
            await this.bus.publishEnvelope(envelope);
            await m.update(OutboxEvent, { seq: row.seq }, { publishedAt: new Date(), attempts: row.attempts + 1, lastError: null });
            ok++;
          } catch (e) {
            await m.update(OutboxEvent, { seq: row.seq }, { attempts: row.attempts + 1, lastError: (e as Error).message.slice(0, 500) });
            this.log.warn(`Publication de ${row.type} différée : ${(e as Error).message}`);
            return { ok, stop: true };
          }
        }
        return { ok, stop: rows.length < 100 };
      });
      total += sent.ok;
      if (sent.stop) return total;
    }
  }

  /** Purge des événements publiés (rétention configurable, 7 jours par défaut) et des traces de déduplication. */
  private async cleanup() {
    try {
      const days = envInt('OUTBOX_RETENTION_DAYS', 7);
      await this.dataSource().query(`DELETE FROM outbox WHERE published_at < now() - ($1 || ' days')::interval`, [days]);
      await this.dataSource().query(`DELETE FROM processed_events WHERE processed_at < now() - ($1 || ' days')::interval`, [days]);
    } catch (e) {
      this.log.warn(`Purge de l'outbox : ${(e as Error).message}`);
    }
  }
}
