import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { OAuthService } from './oauth.service';
import { TokensService } from './tokens.service';

import { generateKeyPairSync } from 'node:crypto';

process.env.JWT_PRIVATE_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
process.env.JWT_ISSUER = 'sfmc-auth';

function refreshRepo() {
  const rows: any[] = [];
  return {
    rows,
    create: (v: any) => v,
    save: jest.fn(async (v: any) => {
      if (!rows.includes(v)) rows.push(v);
      return v;
    }),
    findOne: jest.fn(async ({ where }: any) => rows.find((r) => r.tokenHash === where.tokenHash) ?? null),
    update: jest.fn(async ({ familyId }: any, patch: any) => rows.filter((r) => r.familyId === familyId && !r.revokedAt).forEach((r) => Object.assign(r, patch))),
  };
}

describe('TokensService', () => {
  const tokens = new TokensService();
  it('signe un access token RS256 vérifiable avec rôle et type', async () => {
    const t = tokens.signAccess({ sub: 'u1', role: 'client', email: 'a@b.c' });
    const p = await tokens.verify(t);
    expect(p).toMatchObject({ sub: 'u1', role: 'client', typ: 'access', iss: 'sfmc-auth' });
  });
  it('rejette un jeton altéré', async () => {
    const t = tokens.signAccess({ sub: 'u1', role: 'client' });
    await expect(tokens.verify(t.slice(0, -2) + 'xx')).rejects.toThrow();
  });
});

describe('AuthService (rotation des refresh tokens)', () => {
  const user = { id: 'u1', email: 'a@b.c', role: 'client' };
  const services: any = { post: jest.fn(async () => user), get: jest.fn(async () => user) };

  it('login puis refresh : ancien jeton révoqué, nouveau émis', async () => {
    const repo = refreshRepo();
    const svc = new AuthService(repo as any, new TokensService(), services);
    const first = await svc.login('a@b.c', 'pw');
    expect(first.accessToken).toBeTruthy();
    const second = await svc.refresh(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(repo.rows.filter((r) => !r.revokedAt)).toHaveLength(1);
  });

  it('rejouer un refresh token consommé révoque toute la famille', async () => {
    const repo = refreshRepo();
    const svc = new AuthService(repo as any, new TokensService(), services);
    const first = await svc.login('a@b.c', 'pw');
    const second = await svc.refresh(first.refreshToken);
    await expect(svc.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.refresh(second.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('OAuthService (client credentials)', () => {
  const tokens = new TokensService();
  const client = { clientId: 'order-service', secretHash: tokens.hash('s3cret'), role: 'service', scopes: ['internal'], active: true };
  const repo: any = { findOne: jest.fn(async () => client) };
  const svc = new OAuthService(repo, tokens);

  it('émet un jeton de service pour des identifiants valides', async () => {
    const res = await svc.clientCredentials('order-service', 's3cret');
    await expect(tokens.verify(res.access_token)).resolves.toMatchObject({ sub: 'order-service', role: 'service' });
  });
  it('refuse un mauvais secret', async () => {
    await expect(svc.clientCredentials('order-service', 'nope')).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('restreint le scope demandé aux scopes accordés', async () => {
    const res = await svc.clientCredentials('order-service', 's3cret', 'internal admin:all');
    expect(res.scope).toBe('internal');
  });
});
