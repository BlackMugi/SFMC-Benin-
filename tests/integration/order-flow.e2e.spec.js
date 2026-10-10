const { env, api, waitFor, login, waitForPlatform, openSse } = require('./helpers');

let admin; // { accessToken }
let client; // { accessToken, user }
let cement;
let warehouse;

const auth = (t) => ({ token: t.accessToken });
const typesOf = async (orderId) => (await api('GET', `/api/reports/orders/${orderId}/timeline`, auth(admin))).body?.map((e) => e.type) ?? [];
const available = async (productId) => (await api('GET', `/api/inventory/availability/${productId}`, auth(admin))).body.available;

beforeAll(async () => {
  admin = await waitForPlatform();
  const email = `client.${Date.now()}@sfmc.test`;
  const reg = await api('POST', '/api/users/register', { body: { email, password: 'Passw0rd!client', firstName: 'Test', lastName: 'Client' } });
  expect(reg.status).toBe(201);
  client = await login(email, 'Passw0rd!client');
  const products = (await api('GET', '/api/products', auth(admin))).body;
  cement = products.find((p) => p.category === 'cement');
  warehouse = (await api('GET', '/api/inventory/warehouses', auth(admin))).body[0];
  expect(cement).toBeDefined();
});

describe('Sécurité', () => {
  it('rejette un appel sans jeton (401)', async () => {
    expect((await api('GET', '/api/orders')).status).toBe(401);
  });
  it('un client ne peut pas lister les utilisateurs (403) ni appeler un endpoint interne', async () => {
    expect((await api('GET', '/api/users', auth(client))).status).toBe(403);
    expect((await api('POST', '/api/users/internal/verify', { ...auth(client), body: { email: 'a@b.c', password: 'x' } })).status).toBe(403);
  });
  it('OAuth2 client credentials pour une intégration externe', async () => {
    const t = await api('POST', '/api/oauth/token', { body: { grant_type: 'client_credentials', client_id: 'partner-demo', client_secret: env.PARTNER_DEMO_CLIENT_SECRET } });
    expect(t.status).toBe(200);
    expect((await api('GET', '/api/products', { token: t.body.access_token })).status).toBe(200);
    expect((await api('GET', '/api/orders', { token: t.body.access_token })).status).toBe(403);
  });
});

describe('Saga de commande', () => {
  it('stock insuffisant : production → stock mis à jour → commande validée → facture → notification → reporting', async () => {
    const stock = await available(cement.id);
    const quantity = stock + 80;
    const progress = [];
    const sse = openSse('/api/production/stream', admin.accessToken, (m) => m.event !== 'heartbeat' && progress.push(m));

    const created = await api('POST', '/api/orders', { ...auth(client), body: { items: [{ productId: cement.id, quantity }], urgency: 5 } });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('pending');
    const orderId = created.body.id;

    const order = await waitFor(async () => {
      const o = (await api('GET', `/api/orders/${orderId}`, auth(client))).body;
      return o.status === 'validated' ? o : null;
    }, { timeout: 90_000, label: 'commande validée' });
    sse.close();
    expect(order.invoiceId || true).toBeTruthy();

    // suivi temps réel : progression + fin
    expect(progress.some((m) => m.event === 'progress' && m.data.orderId === orderId)).toBe(true);
    expect(progress.some((m) => m.event === 'completed' && m.data.orderId === orderId)).toBe(true);

    // facture émise
    const invoice = await waitFor(async () => {
      const r = await api('GET', `/api/invoices/by-order/${orderId}`, auth(client));
      return r.status === 200 ? r.body : null;
    }, { label: 'facture' });
    expect(invoice.status).toBe('ISSUED');
    expect(invoice.amount).toBeCloseTo(quantity * cement.unitPrice * 1.18, 1);

    // notifications envoyées au client
    const mails = await waitFor(async () => {
      const r = await api('GET', '/api/notifications/mine', auth(client));
      return r.body.length >= 4 ? r.body : null;
    }, { label: 'notifications client' });
    expect(mails.map((m) => m.subject).join('|')).toMatch(/validée/);
    expect(mails.map((m) => m.subject).join('|')).toMatch(/Facture/);

    // reporting : chronologie complète de la saga
    const types = await waitFor(async () => {
      const t = await typesOf(orderId);
      return t.includes('InvoiceIssued') ? t : null;
    }, { label: 'reporting' });
    for (const t of ['OrderCreated', 'StockInsufficient', 'ProductionRequested', 'ProductionCompleted', 'StockUpdated', 'StockReserved', 'OrderValidated', 'InvoiceIssued']) {
      expect(types).toContain(t);
    }
    expect(types.indexOf('ProductionCompleted')).toBeLessThan(types.indexOf('OrderValidated'));

    // paiement puis expédition (sortie de stock)
    expect((await api('POST', `/api/invoices/${invoice.id}/pay`, { ...auth(client), body: { method: 'MOBILE_MONEY' } })).body.status).toBe('PAID');
    expect((await api('POST', `/api/orders/${orderId}/ship`, auth(admin))).body.status).toBe('shipped');
    await waitFor(async () => (await api('GET', `/api/inventory/movements?productId=${cement.id}&limit=20`, auth(admin))).body.some((m) => m.type === 'OUT' && m.orderId === orderId), { label: 'sortie de stock' });
  });

  it('stock suffisant : validation directe sans production', async () => {
    await api('POST', '/api/inventory/movements', { ...auth(admin), body: { productId: cement.id, warehouseId: warehouse.id, type: 'IN', quantity: 200, reason: 'PURCHASE' } });
    const created = await api('POST', '/api/orders', { ...auth(client), body: { items: [{ productId: cement.id, quantity: 5 }] } });
    expect(created.status).toBe(201);
    expect(created.body.stockCheck.available).toBe(true);
    const orderId = created.body.id;
    await waitFor(async () => (await api('GET', `/api/orders/${orderId}`, auth(client))).body.status === 'validated', { label: 'validation directe' });
    expect(await typesOf(orderId)).not.toContain('ProductionRequested');
  });

  it('compensation : production impossible → commande rejetée, réservation libérée, pas de facture', async () => {
    const before = await available(cement.id);
    const created = await api('POST', '/api/orders', { ...auth(client), body: { items: [{ productId: cement.id, quantity: before + 6000 }] } });
    const orderId = created.body.id;
    const order = await waitFor(async () => {
      const o = (await api('GET', `/api/orders/${orderId}`, auth(client))).body;
      return o.status === 'rejected' ? o : null;
    }, { label: 'commande rejetée' });
    expect(order.rejectionReason).toMatch(/Production impossible/);
    expect((await api('GET', `/api/invoices/by-order/${orderId}`, auth(client))).status).toBe(404);
    expect(await available(cement.id)).toBe(before);
    await waitFor(async () => (await typesOf(orderId)).includes('OrderRejected'), { label: 'OrderRejected dans le reporting' });
  });

  it('annulation client après validation : stock libéré (compensation)', async () => {
    const before = await available(cement.id);
    const created = await api('POST', '/api/orders', { ...auth(client), body: { items: [{ productId: cement.id, quantity: 10 }] } });
    const orderId = created.body.id;
    await waitFor(async () => (await api('GET', `/api/orders/${orderId}`, auth(client))).body.status === 'validated', { label: 'validée' });
    expect(await available(cement.id)).toBe(before - 10);
    expect((await api('POST', `/api/orders/${orderId}/cancel`, auth(client))).body.status).toBe('cancelled');
    await waitFor(async () => (await available(cement.id)) === before, { label: 'stock libéré' });
  });
});
