// Tests de sécurité (OWASP) contre la plateforme réelle : HTTPS via la gateway et appels directs aux
// services. Lancement : docker compose up -d puis npm run test:security
// Le dernier test épuise la limite de tentatives de connexion (1 minute de blocage pour cette IP).
const crypto = require('node:crypto');
const { api, env, login, waitForPlatform } = require('../integration/helpers.js');

const auth = (u) => ({ token: u.accessToken });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const direct = (port, path, headers = {}) => fetch(`http://127.0.0.1:${port}${path}`, { headers });

let admin;
let clientA;
let clientB;
let jwk;

async function newClient(tag) {
  const email = `secu.${tag}.${Date.now()}@sfmc.test`;
  const r = await api('POST', '/api/users/register', { body: { email, password: 'Passw0rd!client', firstName: 'Secu', lastName: tag } });
  expect(r.status).toBe(201);
  return login(email, 'Passw0rd!client');
}

beforeAll(async () => {
  admin = await waitForPlatform();
  clientA = await newClient('a');
  clientB = await newClient('b');
  jwk = (await api('GET', '/api/oauth/jwks')).body.keys[0];
}, 300_000);

const adminClaims = () => ({ sub: '00000000-0000-0000-0000-000000000000', role: 'admin', typ: 'access', iss: env.JWT_ISSUER || 'sfmc-auth', exp: Math.floor(Date.now() / 1000) + 600 });

describe('Transport et en-têtes', () => {
  test('HTTP redirige vers HTTPS', async () => {
    const r = await fetch(`http://127.0.0.1:${env.HTTP_PORT || 8080}/api/products`, { redirect: 'manual' });
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toMatch(/^https:/);
  });

  test('en-têtes de sécurité présents, X-Powered-By absent', async () => {
    const { headers } = await api('GET', '/api/products', auth(admin));
    expect(headers.get('strict-transport-security')).toMatch(/max-age=\d+/);
    expect(headers.get('x-content-type-options')).toMatch(/nosniff/);
    expect(headers.get('x-frame-options')).toBeTruthy();
    expect(headers.get('content-security-policy')).toMatch(/default-src 'self'/);
    expect(headers.get('x-powered-by')).toBeNull();
  });
});

describe('Authentification (JWT RS256)', () => {
  test('sans jeton : 401', async () => {
    expect((await api('GET', '/api/orders')).status).toBe(401);
  });

  test('alg=none rejeté', async () => {
    const token = `${b64({ alg: 'none', typ: 'JWT', kid: jwk.kid })}.${b64(adminClaims())}.`;
    expect((await api('GET', '/api/users', { token })).status).toBe(401);
  });

  test('confusion HS256 signé avec la clé publique : rejeté à la gateway et directement sur un service', async () => {
    const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
    const h = `${b64({ alg: 'HS256', typ: 'JWT', kid: jwk.kid })}.${b64(adminClaims())}`;
    const token = `${h}.${crypto.createHmac('sha256', pub).update(h).digest('base64url')}`;
    expect((await api('GET', '/api/users', { token })).status).toBe(401);
    expect((await direct(3002, '/users', { authorization: `Bearer ${token}` })).status).toBe(401);
  });

  test('signature par une autre clé RSA (kid réel ou inventé) : rejetée', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    for (const kid of [jwk.kid, 'kid-invente']) {
      const h = `${b64({ alg: 'RS256', typ: 'JWT', kid })}.${b64(adminClaims())}`;
      const token = `${h}.${crypto.sign('RSA-SHA256', Buffer.from(h), privateKey).toString('base64url')}`;
      expect((await api('GET', '/api/users', { token })).status).toBe(401);
    }
  });

  test('jeton altéré (élévation du rôle dans le contenu) : rejeté', async () => {
    const [h, , s] = clientA.accessToken.split('.');
    const payload = JSON.parse(Buffer.from(clientA.accessToken.split('.')[1], 'base64url'));
    const token = `${h}.${b64({ ...payload, role: 'admin' })}.${s}`;
    expect((await api('GET', '/api/users', { token })).status).toBe(401);
  });

  test('refresh token rejoué : refusé, et toute la famille de jetons est révoquée', async () => {
    const s = await login(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
    const first = await api('POST', '/api/auth/refresh', { body: { refreshToken: s.refreshToken } });
    expect(first.status).toBe(200);
    expect((await api('POST', '/api/auth/refresh', { body: { refreshToken: s.refreshToken } })).status).toBe(401);
    // le jeton légitime obtenu avant le rejeu est révoqué aussi (détection de vol)
    expect((await api('POST', '/api/auth/refresh', { body: { refreshToken: first.body.refreshToken } })).status).toBe(401);
  });

  test('mauvais mot de passe : 401 sans indiquer si le compte existe', async () => {
    const a = await api('POST', '/api/auth/login', { body: { email: env.ADMIN_EMAIL, password: 'mauvais-mot-de-passe' } });
    const b = await api('POST', '/api/auth/login', { body: { email: 'inconnu@sfmc.test', password: 'mauvais-mot-de-passe' } });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
  });
});

describe('Autorisation (RBAC, accès aux objets, identité)', () => {
  test('client : liste des utilisateurs interdite (403)', async () => {
    expect((await api('GET', '/api/users', auth(clientA))).status).toBe(403);
  });

  test('en-têtes x-user-* fournis par le client ignorés (pas d’élévation de privilège)', async () => {
    const r = await api('GET', '/api/users', { ...auth(clientA), headers: { 'x-user-role': 'admin', 'x-user-id': '00000000-0000-0000-0000-000000000000' } });
    expect(r.status).toBe(403);
  });

  test('appel direct à un service : jeton exigé même avec des en-têtes x-user-* forgés', async () => {
    expect((await direct(3005, '/orders', { 'x-user-role': 'admin', 'x-user-id': 'x' })).status).toBe(401);
  });

  test('un client ne lit ni la commande ni la facture d’un autre client', async () => {
    const product = (await api('GET', '/api/products', auth(clientA))).body[0];
    const order = await api('POST', '/api/orders', { ...auth(clientA), body: { items: [{ productId: product.id, quantity: 1 }] } });
    expect(order.status).toBe(201);
    expect((await api('GET', `/api/orders/${order.body.id}`, auth(clientB))).status).toBe(403);
    expect((await api('GET', `/api/invoices/by-order/${order.body.id}`, auth(clientB))).status).not.toBe(200);
    expect((await api('GET', `/api/orders/${order.body.id}`, auth(clientA))).status).toBe(200);
  });

  test('un client ne modifie pas le profil d’un autre et ne change pas son propre rôle', async () => {
    const meA = (await api('GET', '/api/users/me', auth(clientA))).body;
    const meB = (await api('GET', '/api/users/me', auth(clientB))).body;
    expect((await api('PATCH', `/api/users/${meA.id}`, { ...auth(clientB), body: { firstName: 'Pirate' } })).status).toBe(403);
    expect((await api('PATCH', `/api/users/${meB.id}`, { ...auth(clientB), body: { role: 'admin' } })).status).toBe(403);
  });

  test('endpoints internes et techniques non routés par la gateway', async () => {
    for (const path of ['/api/users/internal/verify', '/api/orders/metrics', '/api/products/health']) {
      expect((await api('GET', path, auth(admin))).status).toBe(403);
    }
  });

  test('partenaire OAuth2 : limité à ses scopes', async () => {
    const t = await api('POST', '/api/oauth/token', { body: { grant_type: 'client_credentials', client_id: 'partner-demo', client_secret: env.PARTNER_DEMO_CLIENT_SECRET, scope: 'catalog:read' } });
    expect(t.status).toBe(200);
    expect((await api('GET', '/api/products', { token: t.body.access_token })).status).toBe(200);
    expect((await api('GET', '/api/orders', { token: t.body.access_token })).status).toBe(403);
  });
});

describe('Validation des entrées et injections', () => {
  test('injection SQL dans les paramètres et à la connexion : aucune erreur serveur, aucun contournement', async () => {
    const q = await api('GET', `/api/products?search=${encodeURIComponent("' OR 1=1;--")}`, auth(admin));
    expect(q.status).toBeLessThan(500);
    const l = await api('POST', '/api/auth/login', { body: { email: "admin@sfmc.bj' OR '1'='1", password: "x' OR '1'='1" } });
    expect([400, 401]).toContain(l.status);
    const id = await api('GET', `/api/orders/${encodeURIComponent("1' OR '1'='1")}`, auth(admin));
    expect(id.status).toBe(400);
  });

  test('XSS : balises retirées des champs texte, réponses uniquement JSON', async () => {
    const email = `xss.${Date.now()}@sfmc.test`;
    const r = await api('POST', '/api/users/register', { body: { email, password: 'Passw0rd!client', firstName: '<script>alert(1)</script>Awa', lastName: 'Dossou<img src=x onerror=alert(1)>' } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ firstName: 'Awa', lastName: 'Dossou' });
    expect(r.headers.get('content-type')).toMatch(/application\/json/);
    expect(JSON.stringify(r.body)).not.toMatch(/<script|onerror/i);
  });

  test('XSS : un champ qui ne contient que du HTML est vide après nettoyage, donc refusé', async () => {
    const r = await api('POST', '/api/users/register', { body: { email: `xss0.${Date.now()}@sfmc.test`, password: 'Passw0rd!client', firstName: 'A', lastName: '<img src=x onerror=alert(1)>' } });
    expect(r.status).toBe(400);
  });

  test('mass assignment : rôle imposé à l’inscription refusé', async () => {
    const r = await api('POST', '/api/users/register', { body: { email: `ma.${Date.now()}@sfmc.test`, password: 'Passw0rd!client', firstName: 'A', lastName: 'B', role: 'admin' } });
    expect(r.status).toBe(400);
  });

  test('DTO stricts : champs inconnus et valeurs invalides refusés', async () => {
    const r = await api('POST', '/api/orders', { ...auth(clientA), body: { items: [{ productId: 'pas-un-uuid', quantity: -5 }], champInconnu: 1 } });
    expect(r.status).toBe(400);
  });

  test('corps de requête > 1 Mo refusé (413)', async () => {
    const r = await api('POST', '/api/auth/login', { body: { email: 'a@b.co', password: 'x'.repeat(2_000_000) } });
    expect(r.status).toBe(413);
  });
});

describe('CORS', () => {
  test('origine inconnue non autorisée, origine configurée autorisée', async () => {
    const evil = await api('OPTIONS', '/api/products', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    const allowed = (env.CORS_ORIGINS || '').split(',')[0].trim();
    const ok = await api('OPTIONS', '/api/products', { headers: { Origin: allowed, 'Access-Control-Request-Method': 'GET' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe(allowed);
  });
});

describe('Rate limiting (anti brute-force)', () => {
  test('tentatives de connexion répétées : 429 avant la fin de la série', async () => {
    const limit = Number(env.GATEWAY_AUTH_RATE_LIMIT || 30);
    let blocked = false;
    for (let i = 0; i < limit + 5 && !blocked; i++) {
      const r = await api('POST', '/api/auth/login', { body: { email: 'brute@sfmc.test', password: `essai-${i}` } });
      blocked = r.status === 429;
    }
    expect(blocked).toBe(true);
  });
});
