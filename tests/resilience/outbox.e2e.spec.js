// Test de résilience de l'outbox : provoque de vraies pannes sur la plateforme de développement.
// ATTENTION : arrête RabbitMQ et tue order-service pendant le test (redémarrés à la fin).
// Lancement : docker compose up -d puis npm run test:resilience
const { execSync } = require('node:child_process');
const path = require('node:path');
const { api, env, login, waitFor, waitForPlatform } = require('../integration/helpers.js');

const root = path.join(__dirname, '..', '..');
const sh = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sql = (service, query) => sh(`docker compose exec -T ${service}-db psql -U ${service} -d ${service} -tAc "${query}"`);
const auth = (u) => ({ token: u.accessToken });

let admin;
let client;
let product;
let warehouseId;

beforeAll(async () => {
  admin = await waitForPlatform();
  const email = `resilience.${Date.now()}@sfmc.test`;
  await api('POST', '/api/users/register', { body: { email, password: 'Passw0rd!client', firstName: 'Test', lastName: 'Resilience' } });
  client = await login(email, 'Passw0rd!client');
  product = (await api('GET', '/api/products', auth(admin))).body[0];
  warehouseId = (await api('GET', '/api/inventory/warehouses', auth(admin))).body[0].id;
}, 300_000);

afterAll(() => {
  // Remise en état quoi qu'il arrive
  sh('docker compose start rabbitmq order-service');
});

test('panne du broker + crash du service : aucun événement perdu, la saga se termine', async () => {
  // Stock suffisant : la commande doit être validée sans production
  await api('POST', '/api/inventory/movements', { ...auth(admin), body: { productId: product.id, warehouseId, type: 'IN', quantity: 5, reason: 'PURCHASE' } });

  // 1. Broker coupé : avant l'outbox, la commande était refusée (503)
  sh('docker compose stop rabbitmq');
  const created = await api('POST', '/api/orders', { ...auth(client), body: { items: [{ productId: product.id, quantity: 2 }] } });
  expect(created.status).toBe(201);
  const orderId = created.body.id;

  // L'événement OrderCreated est enregistré dans l'outbox, en attente de publication
  expect(sql('order', `SELECT count(*) FROM outbox WHERE type='OrderCreated' AND payload->>'orderId'='${orderId}' AND published_at IS NULL`)).toBe('1');

  // 2. Crash brutal du service pendant que l'événement n'est pas publié
  sh('docker compose kill order-service');

  // 3. Retour du broker puis du service : le relais publie l'événement en attente au redémarrage
  sh('docker compose start rabbitmq');
  sh('docker compose start order-service');
  const order = await waitFor(
    async () => {
      const r = await api('GET', `/api/orders/${orderId}`, auth(client));
      return r.status === 200 && r.body.status === 'validated' && r.body.invoiceId ? r.body : null;
    },
    { timeout: 180_000, interval: 2000, label: 'commande validée et facturée après la panne' },
  );
  expect(order.status).toBe('validated');
  expect(sql('order', `SELECT count(*) FROM outbox WHERE payload->>'orderId'='${orderId}' AND published_at IS NULL`)).toBe('0');
}, 300_000);

test('un événement livré deux fois n’est traité qu’une fois (consommateur idempotent)', async () => {
  const created = await api('POST', '/api/orders', { ...auth(client), body: { items: [{ productId: product.id, quantity: 1 }] } });
  expect(created.status).toBe(201);
  const orderId = created.body.id;
  await waitFor(async () => (await api('GET', `/api/orders/${orderId}`, auth(client))).body.status === 'validated', { timeout: 120_000, interval: 1000, label: 'commande validée' });

  // Enveloppe déjà publiée, renvoyée telle quelle (même identifiant) via l'API de RabbitMQ
  const row = sql('order', `SELECT json_build_object('id', event_id, 'type', type, 'occurredAt', occurred_at, 'correlationId', correlation_id, 'source', 'order-service', 'payload', payload) FROM outbox WHERE type='OrderCreated' AND payload->>'orderId'='${orderId}'`);
  const envelope = JSON.parse(row);
  const reservedBefore = sql('inventory', `SELECT sum(reserved) FROM stocks WHERE product_id='${product.id}'`);
  const res = await fetch('http://127.0.0.1:15672/api/exchanges/%2F/sfmc.events/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${env.RABBITMQ_USER}:${env.RABBITMQ_PASSWORD}`).toString('base64') },
    body: JSON.stringify({ routing_key: 'OrderCreated', payload: JSON.stringify(envelope), payload_encoding: 'string', properties: { message_id: envelope.id, content_type: 'application/json' } }),
  });
  expect((await res.json()).routed).toBe(true);

  // Le doublon est reconnu par son identifiant et ignoré : aucune réservation supplémentaire
  await waitFor(async () => /Doublon ignoré : OrderCreated/.test(sh(`docker compose logs inventory-service --since 2m`)), { timeout: 30_000, interval: 1000, label: 'doublon ignoré par inventory' });
  expect(sql('inventory', `SELECT count(*) FROM processed_events WHERE event_id='${envelope.id}'`)).toBe('1');
  expect(sql('inventory', `SELECT sum(reserved) FROM stocks WHERE product_id='${product.id}'`)).toBe(reservedBefore);
}, 300_000);
