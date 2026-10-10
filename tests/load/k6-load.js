// Test de charge k6 : valide l'exigence « réponse < 2 s » sur les endpoints principaux.
// Lancement : npm run load  (voir scripts/load-test.mjs)
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://api-gateway:3000';

export const options = {
  scenarios: {
    lecture: { executor: 'ramping-vus', startVUs: 1, stages: [{ duration: '10s', target: +(__ENV.VUS || 30) }, { duration: __ENV.DURATION || '40s', target: +(__ENV.VUS || 30) }, { duration: '5s', target: 0 }] },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'], // exigence du cahier des charges
    http_req_failed: ['rate<0.01'], // disponibilité : < 1 % d'erreurs
    checks: ['rate>0.99'],
  },
};

export function setup() {
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email: __ENV.ADMIN_EMAIL, password: __ENV.ADMIN_PASSWORD }), { headers: { 'Content-Type': 'application/json' } });
  if (res.status !== 200) throw new Error(`login admin impossible (HTTP ${res.status})`);
  return { token: res.json('accessToken') };
}

export default function (data) {
  const params = { headers: { Authorization: `Bearer ${data.token}` } };
  const urls = ['/api/products', '/api/inventory/warehouses', '/api/inventory/stocks', '/api/orders', '/api/production/machines', '/api/reports/summary'];
  for (const u of urls) {
    const r = http.get(`${BASE}${u}`, params, { tags: { endpoint: u } });
    check(r, { [`${u} 200`]: (x) => x.status === 200 });
  }
  sleep(0.2);
}
