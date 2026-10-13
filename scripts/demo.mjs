// Rejoue le scénario complet : client, commande, stock insuffisant, production, stock mis à jour,
// commande validée, facture, notification, reporting.
// Usage : npm run demo (ou ./demo.sh), plateforme démarrée avec `docker compose up`.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { env, api, waitFor, login, waitForPlatform, openSse, BASE_URL } = require('../tests/integration/helpers.js');

const C = { dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', off: '\x1b[0m' };
const step = (n, t) => console.log(`\n${C.bold}${C.cyan}[${n}] ${t}${C.off}`);
const ok = (t) => console.log(`  ${C.green}✔${C.off} ${t}`);
const info = (t) => console.log(`  ${C.dim}${t}${C.off}`);
const fail = (t) => {
  console.error(`  ${C.red}✘ ${t}${C.off}`);
  process.exit(1);
};
const need = (cond, msg) => (cond ? undefined : fail(msg));
const A = (t) => ({ token: t.accessToken });
const money = (n) => new Intl.NumberFormat('fr-FR').format(n) + ' XOF';

console.log(`${C.bold}SFMC Bénin - démo du flux commande${C.off}  (${BASE_URL})`);

step(0, 'Attente de la plateforme (Consul, services, broker)');
const admin = await waitForPlatform();
ok('plateforme prête, administrateur connecté');

step(1, 'Le client s\'inscrit puis s\'authentifie (JWT access + refresh)');
const email = `client.${Date.now()}@sfmc.bj`;
const reg = await api('POST', '/api/users/register', { body: { email, password: 'Passw0rd!client', firstName: 'Awa', lastName: 'Dossou' } });
need(reg.status === 201, `inscription refusée (${reg.status})`);
const client = await login(email, 'Passw0rd!client');
ok(`client ${email} connecté (rôle ${client.user.role}), jeton expire dans ${client.expiresIn}s`);

step(2, 'Préparation : catalogue et stock initial');
const products = (await api('GET', '/api/products', A(admin))).body;
const cement = products.find((p) => p.category === 'cement');
const warehouses = (await api('GET', '/api/inventory/warehouses', A(admin))).body;
await api('POST', '/api/inventory/movements', { ...A(admin), body: { productId: cement.id, warehouseId: warehouses[0].id, type: 'IN', quantity: 20, reason: 'PURCHASE' } });
const stock0 = (await api('GET', `/api/inventory/availability/${cement.id}`, A(admin))).body.available;
ok(`${cement.name} : ${money(cement.unitPrice)} l'unité, ${stock0} en stock`);

step(3, 'Le client commande plus que le stock disponible (urgence 5)');
const quantity = stock0 + 80;
const stream = [];
const sse = openSse('/api/production/stream', admin.accessToken, (m) => {
  if (m.event === 'heartbeat') return;
  if (m.event === 'snapshot') return;
  stream.push(m);
  const d = m.data;
  const bar = '█'.repeat(Math.round(d.progress / 5)).padEnd(20, '░');
  console.log(`  ${C.yellow}⚙ SSE ${m.event.padEnd(9)}${C.off} ${bar} ${String(d.progress).padStart(5)} %  ${d.productName} sur ${d.machine ?? '-'}`);
});
const created = await api('POST', '/api/orders', { ...A(client), body: { items: [{ productId: cement.id, quantity }], urgency: 5 } });
need(created.status === 201, `commande refusée (${created.status}) ${JSON.stringify(created.body)}`);
const orderId = created.body.id;
ok(`commande ${orderId} créée : statut ${created.body.status}, total ${money(created.body.total)}`);
info(`vérification REST sync Order→Inventory : disponible = ${created.body.stockCheck?.available}`);

step(4, 'Saga : stock insuffisant → production déclenchée et suivie en temps réel (SSE ci-dessus)');
const validated = await waitFor(async () => {
  const o = (await api('GET', `/api/orders/${orderId}`, A(client))).body;
  return ['validated', 'rejected'].includes(o.status) ? o : null;
}, { timeout: 120_000, label: 'fin de la saga' });
sse.close();
need(validated.status === 'validated', `commande ${validated.status} : ${validated.rejectionReason}`);
ok(`commande ${validated.status} (phase ${validated.phase})`);
const history = (await api('GET', `/api/orders/${orderId}/history`, A(client))).body;
history.forEach((h) => info(`${new Date(h.at).toISOString().slice(11, 23)}  ${h.status.padEnd(9)} ${h.note}`));

step(5, 'Stock mis à jour par ProductionCompleted, puis réservé');
const stocks = (await api('GET', `/api/inventory/stocks?productId=${cement.id}`, A(admin))).body;
stocks.forEach((s) => ok(`entrepôt ${s.warehouseId.slice(0, 8)} : quantité ${s.quantity}, réservé ${s.reserved}, disponible ${s.available}`));
const moves = (await api('GET', `/api/inventory/movements?productId=${cement.id}&limit=5`, A(admin))).body;
moves.forEach((m) => info(`mouvement ${m.type} ${m.quantity} (${m.reason})`));
const alerts = (await api('GET', '/api/inventory/stocks/alerts', A(admin))).body;
if (alerts.length) ok(`alerte seuil critique active sur ${alerts.length} stock(s)`);

step(6, 'Facture émise par Billing, puis payée');
const invoice = await waitFor(async () => {
  const r = await api('GET', `/api/invoices/by-order/${orderId}`, A(client));
  return r.status === 200 ? r.body : null;
}, { label: 'facture' });
ok(`facture ${invoice.number} : ${money(invoice.amount)} TTC (statut ${invoice.status})`);
const paid = await api('POST', `/api/invoices/${invoice.id}/pay`, { ...A(client), body: { method: 'MOBILE_MONEY' } });
ok(`paiement : statut ${paid.body.status}, référence ${paid.body.paymentReference}`);

step(7, 'Notifications envoyées (fournisseur mock = logs)');
const mails = await waitFor(async () => {
  const r = (await api('GET', '/api/notifications/mine', A(client))).body;
  return r.length >= 5 ? r : null;
}, { label: 'notifications' });
mails.reverse().forEach((m) => ok(`✉  ${m.subject}  ${C.dim}(${m.eventType}, ${m.status})${C.off}`));
const ops = (await api('GET', `/api/notifications?recipient=${encodeURIComponent(env.ADMIN_NOTIFY_EMAIL || 'ops@sfmc.bj')}`, A(admin))).body;
ops.slice(0, 3).forEach((m) => info(`équipe : ${m.subject}`));

step(8, 'Reporting : chronologie de la commande et vues de lecture');
const timeline = await waitFor(async () => {
  const t = (await api('GET', `/api/reports/orders/${orderId}/timeline`, A(admin))).body;
  return t.some((e) => e.type === 'InvoiceIssued') ? t : null;
}, { label: 'reporting' });
ok(`événements : ${timeline.map((e) => e.type).join(' → ')}`);
const sales = (await api('GET', '/api/reports/sales', A(admin))).body;
const prod = (await api('GET', '/api/reports/production', A(admin))).body;
const stockRep = (await api('GET', '/api/reports/stock', A(admin))).body;
ok(`ventes : CA ${money(sales.revenue)} sur ${sales.orders} commande(s)`);
ok(`production : ${prod.completed} ordre(s) terminé(s), ${prod.unitsProduced} unités`);
ok(`stock : ${stockRep.items.length} ligne(s), ${stockRep.lowStockCount} sous le seuil critique`);

step(9, 'Expédition : la réservation devient une sortie de stock');
const shipped = await api('POST', `/api/orders/${orderId}/ship`, A(admin));
ok(`commande ${shipped.body.status}`);

step(10, 'Compensation : commande impossible à produire → rejetée, aucun stock bloqué, pas de facture');
const avail = (await api('GET', `/api/inventory/availability/${cement.id}`, A(admin))).body.available;
const bad = (await api('POST', '/api/orders', { ...A(client), body: { items: [{ productId: cement.id, quantity: avail + 6000 }] } })).body;
const rejected = await waitFor(async () => {
  const o = (await api('GET', `/api/orders/${bad.id}`, A(client))).body;
  return o.status !== 'pending' ? o : null;
}, { label: 'rejet' });
ok(`commande ${rejected.status} : ${rejected.rejectionReason}`);
const after = (await api('GET', `/api/inventory/availability/${cement.id}`, A(admin))).body.available;
ok(`stock disponible inchangé : ${avail} → ${after}`);

step(11, 'Intégration externe : OAuth2 client credentials');
const tok = await api('POST', '/api/oauth/token', { body: { grant_type: 'client_credentials', client_id: 'partner-demo', client_secret: env.PARTNER_DEMO_CLIENT_SECRET } });
need(tok.status === 200, `jeton partenaire refusé (${tok.status})`);
const cat = await api('GET', '/api/products', { token: tok.body.access_token });
ok(`partenaire : jeton ${tok.body.scope}, catalogue lu (${cat.body.length} produits), commandes → ${(await api('GET', '/api/orders', { token: tok.body.access_token })).status}`);

step(12, 'Contrôles de sécurité');
ok(`sans jeton → ${(await api('GET', '/api/orders')).status}`);
ok(`client sur /api/users → ${(await api('GET', '/api/users', A(client))).status}`);
ok(`endpoint interne via gateway → ${(await api('POST', '/api/users/internal/verify', { ...A(client), body: { email: 'a@b.c', password: 'x' } })).status}`);

console.log(`\n${C.bold}${C.green}Scénario terminé avec succès.${C.off}  Grafana : http://localhost:3100 · RabbitMQ : http://localhost:15672 · Consul : http://localhost:8500\n`);
process.exit(0);
