/** Table de routage : premier segment après /api -> nom du service dans Consul. */
export const ROUTES: Record<string, string> = {
  auth: 'auth-service',
  oauth: 'auth-service',
  users: 'user-service',
  products: 'product-service',
  inventory: 'inventory-service',
  orders: 'order-service',
  production: 'production-service',
  invoices: 'billing-service',
  notifications: 'notification-service',
  reports: 'reporting-service',
};

interface PublicRoute {
  method: string;
  pattern: RegExp;
}

/** Seules routes accessibles sans JWT. */
export const PUBLIC_ROUTES: PublicRoute[] = [
  { method: 'POST', pattern: /^\/api\/auth\/(login|refresh|logout)\/?$/ },
  { method: 'POST', pattern: /^\/api\/oauth\/token\/?$/ },
  // Clés publiques de vérification des jetons (JWKS) : publiques par nature, utiles aux intégrations externes
  { method: 'GET', pattern: /^\/api\/oauth\/jwks\/?$/ },
  { method: 'POST', pattern: /^\/api\/users\/register\/?$/ },
];

/** Endpoints techniques jamais exposés à l'extérieur. */
export const BLOCKED = /\/(internal|metrics|health)(\/|$)/;

export function pathOf(url: string): string {
  return url.split('?')[0];
}

export function isPublic(method: string, url: string): boolean {
  const path = pathOf(url);
  return PUBLIC_ROUTES.some((r) => r.method === method && r.pattern.test(path));
}

export function serviceFor(url: string): string | undefined {
  const segment = pathOf(url).split('/')[2];
  return segment ? ROUTES[segment] : undefined;
}
