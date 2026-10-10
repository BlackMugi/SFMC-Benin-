// Utilitaires partagés par le test d'intégration et le script de démo (CommonJS, Node >= 20, sans dépendance).
const fs = require('node:fs');
const path = require('node:path');

// Certificat auto-signé en développement : TLS non vérifié UNIQUEMENT pour ces scripts locaux.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? '0';

function loadEnv() {
  const file = path.join(__dirname, '..', '..', '.env');
  const vars = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (m) vars[m[1]] = m[2];
    }
  }
  return { ...vars, ...process.env };
}

const env = loadEnv();
const BASE_URL = (env.BASE_URL || `https://localhost:${env.HTTPS_PORT || 8443}`).replace(/\/$/, '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Appel HTTP JSON ; retourne { status, body, headers }. */
async function api(method, url, { token, body, headers } = {}) {
  const res = await fetch(url.startsWith('http') ? url : `${BASE_URL}${url}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

/** Réessaie `fn` jusqu'à ce qu'elle retourne une valeur truthy (ou timeout). */
async function waitFor(fn, { timeout = 60_000, interval = 1000, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* on réessaie */
    }
    if (Date.now() - start > timeout) throw new Error(`Délai dépassé en attendant : ${label}`);
    await sleep(interval);
  }
}

async function login(email, password) {
  const r = await api('POST', '/api/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`Connexion refusée pour ${email} (HTTP ${r.status})`);
  return r.body;
}

/** Attend que la plateforme réponde : login admin + services enregistrés dans Consul. */
async function waitForPlatform(timeout = 240_000) {
  await waitFor(async () => (await api('POST', '/api/auth/login', { body: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD } })).status === 200, { timeout, interval: 3000, label: 'plateforme prête (login admin)' });
  const admin = await login(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
  for (const p of ['/api/products', '/api/inventory/warehouses', '/api/production/machines', '/api/reports/summary', '/api/notifications', '/api/orders', '/api/invoices']) {
    await waitFor(async () => (await api('GET', p, { token: admin.accessToken })).status === 200, { timeout, interval: 3000, label: `route ${p}` });
  }
  return admin;
}

/** Ouvre un flux SSE ; `onEvent({event, data})` est appelé pour chaque message. */
function openSse(url, token, onEvent) {
  const ctrl = new AbortController();
  const done = (async () => {
    try {
      const res = await fetch(url.startsWith('http') ? url : `${BASE_URL}${url}`, { headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' }, signal: ctrl.signal });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const ev = /^event: (.*)$/m.exec(raw)?.[1] ?? 'message';
          const data = /^data: (.*)$/m.exec(raw)?.[1];
          if (data) onEvent({ event: ev, data: JSON.parse(data) });
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') throw e;
    }
  })();
  return { close: () => ctrl.abort(), done };
}

module.exports = { env, BASE_URL, api, sleep, waitFor, login, waitForPlatform, openSse };
