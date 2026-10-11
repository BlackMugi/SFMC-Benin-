import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { EVENTS, Role } from '@sfmc/common';
import { BillingService, computeTotals } from './billing.service';

const payload = {
  orderId: 'o1',
  customerId: 'c1',
  customerEmail: 'c@x.bj',
  total: 650000,
  items: [{ productId: 'p1', productName: 'Ciment', category: 'cement' as const, quantity: 100, unitPrice: 6500 }],
};

function setup() {
  const rows: any[] = [];
  const published: any[] = [];
  const repo: any = {
    exists: jest.fn(async ({ where }: any) => rows.some((r) => r.orderId === where.orderId)),
    create: (v: any) => ({ id: `i${rows.length + 1}`, ...v }),
    save: jest.fn(async (v: any) => (rows.push(v), v)),
    findOne: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id || r.orderId === where.orderId) ?? null),
    findOneOrFail: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id)),
    update: jest.fn(async (cond: any, patch: any) => {
      const r = rows.find((x) => (cond.id ? x.id === cond.id : x.orderId === cond.orderId) && x.status === cond.status);
      if (!r) return { affected: 0 };
      Object.assign(r, patch);
      return { affected: 1 };
    }),
  };
  const ds: any = { query: jest.fn(async (q: string) => (q.includes('nextval') ? [{ nextval: '7' }] : [])) };
  const bus: any = {};
  // EntityManager de transaction : délègue au faux dépôt
  const manager: any = {
    query: ds.query,
    create: (_e: any, v: any) => repo.create(v),
    save: (v: any) => repo.save(v),
    update: (_e: any, cond: any, patch: any) => repo.update(cond, patch),
    findOneOrFail: (_e: any, opts: any) => repo.findOneOrFail(opts),
  };
  // Outbox : les événements ne sont « publiés » que si la transaction réussit
  const outbox: any = {
    run: jest.fn(async (fn: any) => {
      const events: { type: string; payload: any }[] = [];
      const result = await fn(manager, events);
      published.push(...events);
      return result;
    }),
  };
  const payments: any = { charge: jest.fn(async () => ({ reference: 'REF-1' })) };
  return { svc: new BillingService(repo, ds, bus, outbox, payments), rows, published };
}

describe('computeTotals', () => {
  it('calcule HT, TVA et TTC arrondis à 2 décimales', () => {
    expect(computeTotals([{ lineTotal: 650000 }], 0.18)).toEqual({ subtotal: 650000, tax: 117000, amount: 767000 });
    expect(computeTotals([{ lineTotal: 10.01 }], 0.18).tax).toBe(1.8);
  });
});

describe('BillingService', () => {
  it("émet une facture à la validation et publie InvoiceIssued (une seule fois)", async () => {
    const { svc, rows, published } = setup();
    await svc.issue(payload);
    await svc.issue(payload);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ number: expect.stringMatching(/^INV-\d{4}-000007$/), amount: 767000, status: 'ISSUED' });
    expect(published.map((p) => p.type)).toEqual([EVENTS.InvoiceIssued]);
  });

  it('annule la facture non payée quand la commande est annulée (compensation)', async () => {
    const { svc, rows } = setup();
    await svc.issue(payload);
    await svc.cancelForOrder('o1');
    expect(rows[0].status).toBe('CANCELLED');
  });

  it('paiement : une seule fois, jamais sur une facture annulée, jamais pour un autre client', async () => {
    const { svc, rows } = setup();
    await svc.issue(payload);
    const owner = { id: 'c1', role: Role.Client, scopes: [] };
    await expect(svc.pay('i1', 'CARD', { ...owner, id: 'c2' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.pay('i1', 'CARD', owner)).resolves.toMatchObject({ status: 'PAID', paymentReference: 'REF-1' });
    await expect(svc.pay('i1', 'CARD', owner)).rejects.toBeInstanceOf(ConflictException);
    rows[0].status = 'CANCELLED';
    await expect(svc.pay('i1', 'CARD', owner)).rejects.toBeInstanceOf(BadRequestException);
  });
});
