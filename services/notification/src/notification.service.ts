import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser, EventBus, EventEnvelope, EventType, Role, env } from '@sfmc/common';
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

  async handle(e: EventEnvelope<any>): Promise<void> {
    if (e.type === 'OrderCreated' && e.payload.customerEmail) {
      await this.contacts.upsert({ orderId: e.payload.orderId, email: e.payload.customerEmail }, ['orderId']);
    }
    const msg = render(e);
    if (!msg) return;
    const recipient = msg.recipient === 'ops' ? env('ADMIN_NOTIFY_EMAIL', 'ops@sfmc.bj') : await this.customerEmail(e.payload);
    // Contact client pas encore connu (OrderCreated en cours de traitement) : on laisse le bus ré-essayer.
    if (!recipient) throw new Error(`destinataire inconnu pour ${e.type} (commande ${e.payload.orderId ?? '-'})`);
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

  private async customerEmail(payload: any): Promise<string | null> {
    if (payload.customerEmail) return payload.customerEmail;
    if (payload.orderId) return (await this.contacts.findOne({ where: { orderId: payload.orderId } }))?.email ?? null;
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
