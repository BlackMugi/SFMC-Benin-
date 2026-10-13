import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthUser, EVENTS, Role } from '@sfmc/common';
import { canTransition, sourcesFor } from './order-state';
import { OrdersService } from './orders.service';

const client: AuthUser = { id: 'c1', role: Role.Client, email: 'c@x.bj', scopes: [] };

function setup(over: { product?: any; availability?: any } = {}) {
  const rows = new Map<string, any>();
  const published: { type: string; payload: any }[] = [];
  const orders: any = {
    create: (v: any) => ({ id: `o${rows.size + 1}`, createdAt: new Date(), ...v }),
    save: jest.fn(async (v: any) => (rows.set(v.id, v), v)),
    findOne: jest.fn(async ({ where }: any) => rows.get(where.id) ?? null),
    findOneOrFail: jest.fn(async ({ where }: any) => rows.get(where.id)),
    find: jest.fn(async () => [...rows.values()]),
    // compare-and-set : applique le patch si les conditions status/phase sont vraies
    update: jest.fn(async (cond: any, patch: any) => {
      const row = rows.get(cond.id);
      if (!row) return { affected: 0 };
      if (cond.status) {
        const allowed = cond.status._value ?? [cond.status];
        if (!allowed.includes(row.status)) return { affected: 0 };
      }
      if (cond.phase && row.phase !== cond.phase) return { affected: 0 };
      Object.assign(row, patch);
      return { affected: 1 };
    }),
  };
  const history: any = { create: (v: any) => v, save: jest.fn(async (v: any) => v) };
  const bus: any = {};
  // EntityManager de transaction délégant aux faux dépôts
  const manager: any = {
    create: (entity: any, v: any) => (entity.name === 'Order' ? orders.create(v) : history.create(v)),
    save: (v: any) => ('customerId' in v ? orders.save(v) : history.save(v)),
    findOne: (_e: any, opts: any) => orders.findOne(opts),
    findOneOrFail: (_e: any, opts: any) => orders.findOneOrFail(opts),
    update: (_e: any, cond: any, patch: any) => orders.update(cond, patch),
  };
  // Outbox : événements publiés seulement si la transaction réussit
  const outbox: any = {
    run: jest.fn(async (fn: any) => {
      const events: { type: string; payload: any }[] = [];
      const result = await fn(manager, events);
      published.push(...events);
      return result;
    }),
  };
  const services: any = {
    get: jest.fn(async () => over.product ?? { id: 'p1', name: 'Ciment', category: 'cement', unitPrice: 6500, active: true }),
    post: jest.fn(async () => over.availability ?? { available: false, lines: [] }),
  };
  return { svc: new OrdersService(orders, history, bus, outbox, services), rows, published, services };
}

describe('machine à états', () => {
  it('autorise pending→validated→shipped et interdit les retours en arrière', () => {
    expect(canTransition('pending', 'validated')).toBe(true);
    expect(canTransition('validated', 'shipped')).toBe(true);
    expect(canTransition('shipped', 'pending')).toBe(false);
    expect(canTransition('pending', 'shipped')).toBe(false);
    expect(sourcesFor('shipped')).toEqual(['validated']);
  });
});

describe('OrdersService - création', () => {
  it('calcule le total, crée la commande pending et publie OrderCreated', async () => {
    const { svc, published, services } = setup();
    const order = await svc.create(client, { items: [{ productId: 'p1', quantity: 2 }, { productId: 'p1', quantity: 3 }], urgency: 4 });
    expect(order.status).toBe('pending');
    expect(order.total).toBe(5 * 6500);
    expect(order.items).toHaveLength(1);
    expect(services.post).toHaveBeenCalledWith('inventory-service', '/inventory/availability', { items: [{ productId: 'p1', quantity: 5 }] });
    expect(published[0]).toMatchObject({ type: EVENTS.OrderCreated, payload: { orderId: order.id, customerEmail: 'c@x.bj', urgency: 4 } });
  });

  it('refuse un produit inactif', async () => {
    const { svc } = setup({ product: { id: 'p1', name: 'X', category: 'iron', unitPrice: 1, active: false } });
    await expect(svc.create(client, { items: [{ productId: 'p1', quantity: 1 }] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un client ne voit pas la commande d\'un autre', async () => {
    const { svc } = setup();
    const order = await svc.create(client, { items: [{ productId: 'p1', quantity: 1 }] });
    await expect(svc.get(order.id, { ...client, id: 'autre' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('OrdersService - saga', () => {
  async function pendingOrder() {
    const ctx = setup();
    const order = await ctx.svc.create(client, { items: [{ productId: 'p1', quantity: 100 }] });
    ctx.published.length = 0;
    return { ...ctx, order };
  }

  it('StockReserved : pending → validated + OrderValidated (idempotent au rejeu)', async () => {
    const { svc, order, published, rows } = await pendingOrder();
    await svc.onStockReserved(order.id);
    await svc.onStockReserved(order.id);
    expect(rows.get(order.id).status).toBe('validated');
    expect(published.filter((p) => p.type === EVENTS.OrderValidated)).toHaveLength(1);
  });

  it('StockInsufficient : demande la production des quantités manquantes (une seule fois)', async () => {
    const { svc, order, published, rows } = await pendingOrder();
    const payload = { orderId: order.id, shortages: [{ productId: 'p1', requested: 100, available: 20, missing: 80 }] };
    await svc.onStockInsufficient(payload);
    await svc.onStockInsufficient(payload);
    const requests = published.filter((p) => p.type === EVENTS.ProductionRequested);
    expect(requests).toHaveLength(1);
    expect(requests[0].payload).toMatchObject({ orderId: order.id, quantity: 80, category: 'cement' });
    expect(rows.get(order.id).phase).toBe('awaiting_production');
  });

  it('ProductionFailed : commande rejetée + OrderRejected (compensation du stock côté Inventory)', async () => {
    const { svc, order, published, rows } = await pendingOrder();
    await svc.onProductionFailed({ orderId: order.id, productId: 'p1', reason: 'aucune machine' });
    expect(rows.get(order.id)).toMatchObject({ status: 'rejected', phase: 'closed' });
    expect(published.map((p) => p.type)).toEqual([EVENTS.OrderRejected]);
  });

  it('StockReserved tardif sur commande annulée : republie OrderCancelled pour libérer le stock', async () => {
    const { svc, order, published } = await pendingOrder();
    await svc.cancel(order.id, client);
    published.length = 0;
    await svc.onStockReserved(order.id);
    expect(published.map((p) => p.type)).toEqual([EVENTS.OrderCancelled]);
  });

  it('expédition uniquement depuis validated', async () => {
    const { svc, order } = await pendingOrder();
    await expect(svc.ship(order.id)).rejects.toBeInstanceOf(BadRequestException);
    await svc.onStockReserved(order.id);
    await expect(svc.ship(order.id)).resolves.toMatchObject({ status: 'shipped' });
  });
});
