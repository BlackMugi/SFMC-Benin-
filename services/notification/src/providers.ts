import { Injectable, Logger } from '@nestjs/common';

export interface OutgoingMessage {
  to: string;
  subject: string;
  body: string;
}

/**
 * Contrat d'un fournisseur de notification. Pour brancher un vrai fournisseur (SMTP, SendGrid, SMS...),
 * implémenter `send` puis l'enregistrer dans `createProvider` (variable NOTIFICATION_PROVIDER).
 */
export abstract class NotificationProvider {
  abstract readonly channel: string;
  abstract send(message: OutgoingMessage): Promise<void>;
}

/** Fournisseur factice : écrit l'email dans les logs. */
@Injectable()
export class MockNotificationProvider extends NotificationProvider {
  readonly channel = 'LOG';
  private readonly log = new Logger('MockEmail');

  async send(m: OutgoingMessage): Promise<void> {
    this.log.log(`EMAIL -> ${m.to} | ${m.subject}`);
  }
}

/** Exemple de fournisseur réel : relaie vers un webhook HTTP (passerelle email/SMS maison, Zapier, n8n...). */
@Injectable()
export class WebhookNotificationProvider extends NotificationProvider {
  readonly channel = 'EMAIL';

  constructor(private readonly url: string) {
    super();
  }

  async send(m: OutgoingMessage): Promise<void> {
    const res = await fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m), signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Webhook de notification : HTTP ${res.status}`);
  }
}

export function createProvider(): NotificationProvider {
  switch ((process.env.NOTIFICATION_PROVIDER ?? 'mock').toLowerCase()) {
    case 'mock':
      return new MockNotificationProvider();
    case 'webhook': {
      const url = process.env.NOTIFICATION_WEBHOOK_URL;
      if (!url) throw new Error('NOTIFICATION_WEBHOOK_URL requis pour NOTIFICATION_PROVIDER=webhook');
      return new WebhookNotificationProvider(url);
    }
    default:
      throw new Error(`NOTIFICATION_PROVIDER inconnu : ${process.env.NOTIFICATION_PROVIDER}`);
  }
}
