import { stripHtml } from './sanitize';
import { env, envBool, envInt } from './config';
import { getCorrelationId, runWithContext } from './context';
import { JsonLogger } from './logger';
import { createHmac, generateKeyPairSync, KeyObject } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { extractBearer, verifyAccessToken } from './auth';
import { jwkThumbprint, keyStore, publicJwks, signAccessToken } from './jwks';

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
    expect(stripHtml('<script>alert(1)</script>Awa<STYLE>body{}</STYLE>')).toBe('Awa');
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

describe('JWT RS256 + JWKS', () => {
  const pair = () => generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = (k: KeyObject, type: 'pkcs8' | 'spki') => k.export({ type, format: 'pem' }).toString();
  const current = pair();
  const previous = pair();
  const attacker = pair();
  const kidOf = (k: KeyObject) => jwkThumbprint(k.export({ format: 'jwk' }));

  beforeAll(() => {
    process.env.JWT_PRIVATE_KEY = Buffer.from(pem(current.privateKey, 'pkcs8')).toString('base64');
    process.env.JWT_PREVIOUS_PUBLIC_KEY = Buffer.from(pem(previous.publicKey, 'spki')).toString('base64');
    process.env.JWT_ISSUER = 'sfmc-auth';
    keyStore.reset();
  });
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const claims = { sub: 'u1', role: 'admin', typ: 'access', iss: 'sfmc-auth', exp: Math.floor(Date.now() / 1000) + 60 };

  it('publie la clé courante et la clé précédente (rotation) dans le JWKS', () => {
    const { keys } = publicJwks();
    expect(keys.map((k) => k.kid)).toEqual([kidOf(current.publicKey), kidOf(previous.publicKey)]);
    expect(keys.every((k) => k.alg === 'RS256' && k.use === 'sig' && !('d' in k))).toBe(true); // aucune partie privée publiée
  });

  it('extrait le Bearer et vérifie un access token RS256 valide', async () => {
    expect(extractBearer('Bearer abc')).toBe('abc');
    expect(extractBearer('Basic abc')).toBeUndefined();
    const user = await verifyAccessToken(signAccessToken({ sub: 'u1', role: 'admin', scope: 'a b' }, 60));
    expect(user).toEqual({ id: 'u1', role: 'admin', email: undefined, scopes: ['a', 'b'] });
  });

  it('accepte un jeton signé par la clé précédente pendant la rotation', async () => {
    const t = jwt.sign(claims, previous.privateKey, { algorithm: 'RS256', keyid: kidOf(previous.publicKey) });
    await expect(verifyAccessToken(t)).resolves.toMatchObject({ id: 'u1' });
  });

  it('rejette : autre clé, alg=none, confusion HS256 avec la clé publique, kid inconnu, type refresh', async () => {
    const forged = jwt.sign(claims, attacker.privateKey, { algorithm: 'RS256', keyid: kidOf(current.publicKey) });
    await expect(verifyAccessToken(forged)).rejects.toThrow();
    const none = `${b64({ alg: 'none', typ: 'JWT', kid: kidOf(current.publicKey) })}.${b64(claims)}.`;
    await expect(verifyAccessToken(none)).rejects.toThrow();
    const confusion = `${b64({ alg: 'HS256', typ: 'JWT', kid: kidOf(current.publicKey) })}.${b64(claims)}`;
    const sig = createHmac('sha256', pem(current.publicKey, 'spki')).update(confusion).digest('base64url');
    await expect(verifyAccessToken(`${confusion}.${sig}`)).rejects.toThrow();
    const unknownKid = jwt.sign(claims, attacker.privateKey, { algorithm: 'RS256', keyid: 'kid-invente' });
    await expect(verifyAccessToken(unknownKid)).rejects.toThrow();
    const refresh = jwt.sign({ ...claims, typ: 'refresh' }, current.privateKey, { algorithm: 'RS256', keyid: kidOf(current.publicKey) });
    await expect(verifyAccessToken(refresh)).rejects.toThrow();
  });
});
