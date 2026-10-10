import { BLOCKED, isPublic, serviceFor } from './routes';

describe('routes de la gateway', () => {
  it('route vers le bon service via le premier segment', () => {
    expect(serviceFor('/api/orders/123?x=1')).toBe('order-service');
    expect(serviceFor('/api/invoices')).toBe('billing-service');
    expect(serviceFor('/api/oauth/token')).toBe('auth-service');
    expect(serviceFor('/api/unknown')).toBeUndefined();
  });

  it('seules les routes d\'authentification sont publiques', () => {
    expect(isPublic('POST', '/api/auth/login')).toBe(true);
    expect(isPublic('POST', '/api/users/register')).toBe(true);
    expect(isPublic('GET', '/api/users')).toBe(false);
    expect(isPublic('POST', '/api/oauth/introspect')).toBe(false);
    expect(isPublic('GET', '/api/auth/login')).toBe(false);
  });

  it('bloque les endpoints internes et techniques', () => {
    expect(BLOCKED.test('/api/users/internal/verify')).toBe(true);
    expect(BLOCKED.test('/api/orders/metrics')).toBe(true);
    expect(BLOCKED.test('/api/orders/123')).toBe(false);
  });
});
