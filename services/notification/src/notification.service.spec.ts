import { EventEnvelope } from '@sfmc/common';
import { NotificationService } from './notification.service';
import { render } from './templates';

const env = (type: string, payload: any, id = 'e1'): EventEnvelope<any> => ({ id, type: type as any, occurredAt: new Date().toISOString(), correlationId: 'corr', source: 't', payload });

function setup() {
  const sent: any[] = [];
  const saved: any[] = [];
  const contacts = new Map<string, string>();
  const notifications: any = {
    exists: jest.fn(async ({ where }: any) => saved.some((s) => s.eventId === where.eventId && s.recipient === where.recipient && s.status === where.status)),
    create: (v: any) => v,
    upsert: jest.fn(async (v: any) => saved.push(v)),
  };
  const contactRepo: any = {
    upsert: jest.fn(async (v: any) => contacts.set(v.orderId, v.email)),
    findOne: jest.fn(async ({ where }: any) => (contacts.has(where.orderId) ? { email: contacts.get(where.orderId) } : null)),
  };
  const provider: any = { channel: 'LOG', send: jest.fn(async (m: any) => sent.push(m)) };
  process.env.ADMIN_NOTIFY_EMAIL = 'ops@sfmc.bj';
  return { svc: new NotificationService(notifications, contactRepo, {} as any, provider), sent, saved, provider };
}

describe('templates', () => {
  it('rend un message français pour la facture', () => {
    const m = render(env('InvoiceIssued', { number: 'INV-2026-000001', amount: 767000, currency: 'XOF' }));
    expect(m?.recipient).toBe('customer');
    expect(m?.body).toContain('INV-2026-000001');
  });
  it("ignore les événements non notifiés", () => {
    expect(render(env('StockUpdated', {}))).toBeNull();
  });
});

describe('NotificationService', () => {
  it("retrouve l'email du client depuis OrderCreated pour les événements suivants", async () => {
    const { svc, sent } = setup();
    await svc.handle(env('OrderCreated', { orderId: 'o1', customerEmail: 'c@x.bj', total: 10 }, 'e1'));
    await svc.handle(env('StockInsufficient', { orderId: 'o1', shortages: [] }, 'e2'));
    expect(sent.map((s) => s.to)).toEqual(['c@x.bj', 'c@x.bj']);
  });

  it("envoie les alertes de seuil critique à l'équipe", async () => {
    const { svc, sent } = setup();
    await svc.handle(env('StockLow', { productId: 'abcdefghij', warehouseId: 'w1234567', available: 3, threshold: 10 }));
    expect(sent[0].to).toBe('ops@sfmc.bj');
  });

  it('est idempotent : un événement rejoué ne renvoie pas de notification', async () => {
    const { svc, sent } = setup();
    const e = env('OrderValidated', { orderId: 'o1', customerEmail: 'c@x.bj', total: 5 }, 'same');
    await svc.handle(e);
    await svc.handle(e);
    expect(sent).toHaveLength(1);
  });

  it("lève une erreur si le fournisseur échoue (ré-essai/dead-letter par le bus)", async () => {
    const { svc, provider, saved } = setup();
    provider.send.mockRejectedValueOnce(new Error('smtp down'));
    await expect(svc.handle(env('OrderValidated', { orderId: 'o1', customerEmail: 'c@x.bj', total: 5 }, 'x'))).rejects.toThrow();
    expect(saved[0].status).toBe('FAILED');
  });
});
