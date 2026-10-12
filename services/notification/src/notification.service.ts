import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser, DomainEvent, EventBus, EventType, Role, env, orderIdOf } from '@sfmc/common';
import { Notification, OrderContact } from './entities';
import { NotificationProvider } from './providers';
import { NOTIFIED_EVENTS, render } from './templates';

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly log = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    @InjectRepository(OrderContact) private readonly contacts: Repository<OrderContact>,
    private readonly bus: EventBus,
    private readonly provider: NotificationProvider,
  ) {}

  async onModuleInit() {
    await this.bus.subscribe('notification.events', [...NOTIFIED_EVENTS] as EventType[], (e) => this.handle(e));
  }

  async handle(e: DomainEvent): Promise<void> {
    if (e.type === 'OrderCreated' && e.payload.customerEmail) {
      await this.contacts.upsert({ orderId: e.payload.orderId, email: e.payload.customerEmail }, ['orderId']);
    }
    const msg = render(e);
    if (!msg) return;
    const recipient = msg.recipient === 'ops' ? env('ADMIN_NOTIFY_EMAIL', 'ops@sfmc.bj') : await this.customerEmail(e);
    // Contact client pas encore connu (OrderCreated en cours de traitement) : on laisse le bus ré-essayer.
    if (!recipient) throw new Error(`destinataire inconnu pour ${e.type} (commande ${orderIdOf(e) ?? '-'})`);
    if (await this.notifications.exists({ where: { eventId: e.id, recipient, status: 'SENT' } })) return; // rejeu
    let status: 'SENT' | 'FAILED' = 'SENT';
    try {
      await this.provider.send({ to: recipient, subject: msg.subject, body: msg.body });
    } catch (err) {
      status = 'FAILED';
      this.log.error(`Envoi échoué vers ${recipient} : ${(err as Error).message}`);
    }
    await this.notifications.upsert(
      { eventId: e.id, eventType: e.type, recipient, channel: this.provider.channel, subject: msg.subject, body: msg.body, status, correlationId: e.correlationId },
      ['eventId', 'recipient'],
    );
    if (status === 'FAILED') throw new Error('envoi de notification échoué'); // -> ré-essai puis dead-letter
  }

  /** E-mail du client : porté par l'événement, sinon retrouvé par la commande (contact mémorisé à OrderCreated). */
  private async customerEmail(e: DomainEvent): Promise<string | null> {
    if ('customerEmail' in e.payload && e.payload.customerEmail) return e.payload.customerEmail;
    const orderId = orderIdOf(e);
    if (orderId) return (await this.contacts.findOne({ where: { orderId } }))?.email ?? null;
    return null;
  }

  list(recipient?: string, limit = 100) {
    return this.notifications.find({ where: recipient ? { recipient } : {}, order: { createdAt: 'DESC' }, take: Math.min(Math.max(limit, 1), 500) });
  }

  mine(user: AuthUser) {
    if (!user.email || user.role === Role.Service) return Promise.resolve([]);
    return this.list(user.email);
  }
}
