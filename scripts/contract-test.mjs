// Tests de contrat entre services.
//  1. Catalogue : producteurs et consommateurs de chaque événement lus dans le code, comparés à docs/01-architecture.md.
//     Tout écart fait échouer le test, de même qu'un événement sans producteur ou sans consommateur.
//  2. --live : les événements des outbox de la plateforme démarrée sont validés contre leur contrat.
// Usage : npm run build && npm run test:contracts [-- --live]
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import crypto from 'node:crypto';

const root = resolve('.');
const { EVENTS, EVENT_CONTRACTS, contractViolations } = createRequire(join(root, 'packages/common/package.json'))('./dist/index.js');
const ALL = Object.keys(EVENTS);
const SERVICES = { order: 'Order', inventory: 'Inventory', production: 'Production', billing: 'Billing', notification: 'Notification', reporting: 'Reporting', auth: 'Auth', user: 'User', product: 'Product' };

let failed = false;
const lines = [];
const check = (label, ok, detail = '') => {
  lines.push(`${ok ? 'OK   ' : 'ECHEC'} ${label}${detail ? ` : ${detail}` : ''}`);
  if (!ok) failed = true;
};
const eq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const fmt = (s) => [...s].sort().join(', ') || '(aucun)';

// Catalogue lu dans le code
const produced = Object.fromEntries(ALL.map((e) => [e, new Set()]));
const consumed = Object.fromEntries(ALL.map((e) => [e, new Set()]));
for (const [dir, name] of Object.entries(SERVICES)) {
  const src = join(root, 'services', dir, 'src');
  const code = readdirSync(src)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .map((f) => readFileSync(join(src, f), 'utf8'))
    .join('\n');
  // Consommation : listes passées à bus.subscribe(...)
  const subscribeCalls = code.match(/bus\.subscribe\([\s\S]*?\);/g) ?? [];
  for (const call of subscribeCalls) {
    if (call.includes('Object.keys(EVENTS)')) ALL.forEach((e) => consumed[e].add(name));
    for (const [, e] of call.matchAll(/EVENTS\.(\w+)/g)) consumed[e].add(name);
    if (call.includes('NOTIFIED_EVENTS')) {
      const list = /NOTIFIED_EVENTS = \[([\s\S]*?)\]/.exec(code)?.[1] ?? '';
      for (const [, e] of list.matchAll(/'(\w+)'/g)) consumed[e].add(name);
    }
  }
  // Production : toute autre référence EVENTS.X (les publications passent par l'outbox)
  const withoutSubscriptions = subscribeCalls.reduce((c, call) => c.replace(call, ''), code);
  for (const [, e] of withoutSubscriptions.matchAll(/EVENTS\.(\w+)/g)) produced[e].add(name);
}

// Catalogue documenté
const doc = readFileSync(join(root, 'docs/01-architecture.md'), 'utf8').replace(/\r\n/g, '\n');
const table = /## Catalogue d'événements\n\n((?:\|.*(?:\n|$))+)/.exec(doc)?.[1].trim() ?? '';
const documented = {};
for (const row of table.split('\n').slice(2)) {
  const [, events, producers, consumers] = row.split('|').map((c) => c.trim());
  const names = (cell) => new Set(cell.replace(/\([^)]*\)/g, '').split(',').map((s) => s.trim()).filter(Boolean));
  for (const [, e] of events.matchAll(/`(\w+)`/g)) documented[e] = { producers: names(producers), consumers: names(consumers) };
}

for (const e of ALL) {
  check(`${e} : contrat défini`, !!EVENT_CONTRACTS[e]);
  check(`${e} : au moins un producteur`, produced[e].size > 0, fmt(produced[e]));
  check(`${e} : au moins un consommateur`, consumed[e].size > 0, fmt(consumed[e]));
  const d = documented[e];
  if (!d) {
    check(`${e} : présent dans le catalogue documenté`, false);
    continue;
  }
  check(`${e} : producteurs documentés = code`, eq(d.producers, produced[e]), `doc ${fmt(d.producers)} / code ${fmt(produced[e])}`);
  check(`${e} : consommateurs documentés = code`, eq(d.consumers, consumed[e]), `doc ${fmt(d.consumers)} / code ${fmt(consumed[e])}`);
}
for (const e of Object.keys(documented)) if (!ALL.includes(e)) check(`${e} : documenté mais inexistant dans le code`, false);

// Événements réels (--live)
if (process.argv.includes('--live')) {
  const counts = {};
  for (const db of ['order', 'inventory', 'production', 'billing']) {
    const json = execFileSync('docker', ['compose', 'exec', '-T', `${db}-db`, 'psql', '-U', db, '-d', db, '-tAc', `SELECT coalesce(json_agg(json_build_object('type', type, 'payload', payload)), '[]') FROM outbox`], { cwd: root, encoding: 'utf8' });
    for (const ev of JSON.parse(json)) {
      counts[ev.type] = (counts[ev.type] ?? 0) + 1;
      const v = contractViolations(ev.type, ev.payload);
      if (v.length) check(`événement réel ${ev.type} (${db})`, false, v.join(' ; '));
    }
  }
  // Réception : un message non conforme publié sur le vrai broker doit partir en dead-letter sans être traité
  const env = Object.fromEntries(readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const rabbit = (path, body) =>
    fetch(`http://127.0.0.1:15672/api${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${env.RABBITMQ_USER}:${env.RABBITMQ_PASSWORD}`).toString('base64') },
      body: body && JSON.stringify(body),
    }).then((r) => r.json());
  const deadBefore = (await rabbit('/queues/%2F/sfmc.dead-letters')).messages ?? 0;
  const bad = { id: crypto.randomUUID(), type: 'StockReleased', occurredAt: new Date().toISOString(), correlationId: 'contract-test', source: 'contract-test', payload: { orderId: 'pas-un-uuid' } };
  await rabbit('/exchanges/%2F/sfmc.events/publish', { routing_key: 'StockReleased', payload: JSON.stringify(bad), payload_encoding: 'string', properties: { message_id: bad.id } });
  let deadAfter = deadBefore;
  for (let i = 0; i < 30 && deadAfter <= deadBefore; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    deadAfter = (await rabbit('/queues/%2F/sfmc.dead-letters')).messages ?? 0;
  }
  check('message reçu non conforme : écarté en dead-letter sans traitement', deadAfter > deadBefore, `dead-letters ${deadBefore} → ${deadAfter}`);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  check(`événements réels conformes (${total} vérifiés, ${Object.keys(counts).length} types sur ${ALL.length})`, total > 0, Object.entries(counts).map(([t, n]) => `${t}×${n}`).join(' '));
}

console.log(lines.filter((l) => l.startsWith('ECHEC') || process.argv.includes('--verbose')).join('\n'));
console.log(`\n${lines.filter((l) => l.startsWith('OK')).length} contrôles OK, ${lines.filter((l) => l.startsWith('ECHEC')).length} en échec.`);
for (const l of lines.filter((x) => x.includes('événements réels conformes') || x.includes('dead-letter'))) console.log(l);
process.exit(failed ? 1 : 0);
