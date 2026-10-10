import { stripHtml } from './sanitize';
import { env, envBool, envInt } from './config';
import { getCorrelationId, runWithContext } from './context';
import { JsonLogger } from './logger';
import { extractBearer, verifyAccessToken } from './auth';
import * as jwt from 'jsonwebtoken';

describe('config', () => {
  it('exige les variables requises et lit les valeurs par défaut', () => {
    delete process.env.XYZ_MISSING;
    expect(() => env('XYZ_MISSING')).toThrow(/XYZ_MISSING/);
    expect(env('XYZ_MISSING', 'def')).toBe('def');
    process.env.XYZ_NUM = '42';
    process.env.XYZ_BOOL = 'true';
    expect(envInt('XYZ_NUM', 1)).toBe(42);
    expect(envBool('XYZ_BOOL', false)).toBe(true);
  });
});

describe('sanitize', () => {
  it('retire les balises HTML', () => {
    expect(stripHtml('<img src=x onerror=alert(1)>Bonjour <b>Awa</b>')).toBe('Bonjour Awa');
  });
});

describe('correlation-id', () => {
  it('est propagé dans le contexte asynchrone et apparaît dans les logs JSON', async () => {
    const lines: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((s: any) => (lines.push(String(s)), true));
    await runWithContext('corr-123', async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(getCorrelationId()).toBe('corr-123');
      new JsonLogger('svc', 'info').log('hello', 'Ctx');
    });
    spy.mockRestore();
    expect(JSON.parse(lines[0])).toMatchObject({ level: 'info', service: 'svc', correlationId: 'corr-123', msg: 'hello', context: 'Ctx' });
  });
});

describe('JWT', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret';
    process.env.JWT_ISSUER = 'sfmc-auth';
  });
  const sign = (claims: object, secret = process.env.JWT_SECRET!) => jwt.sign(claims, secret, { issuer: 'sfmc-auth', expiresIn: 60 });

  it('extrait le Bearer et vérifie un access token valide', () => {
    expect(extractBearer('Bearer abc')).toBe('abc');
    expect(extractBearer('Basic abc')).toBeUndefined();
    const user = verifyAccessToken(sign({ sub: 'u1', role: 'admin', typ: 'access', scope: 'a b' }));
    expect(user).toEqual({ id: 'u1', role: 'admin', email: undefined, scopes: ['a', 'b'] });
  });

  it('rejette une mauvaise signature et un jeton qui n\'est pas de type access', () => {
    expect(() => verifyAccessToken(sign({ sub: 'u1', role: 'admin', typ: 'access' }, 'autre-secret-autre-secret-autre'))).toThrow();
    expect(() => verifyAccessToken(sign({ sub: 'u1', role: 'admin', typ: 'refresh' }))).toThrow();
  });
});
