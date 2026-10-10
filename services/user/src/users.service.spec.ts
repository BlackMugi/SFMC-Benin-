import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthUser, Role } from '@sfmc/common';
import { UsersService } from './users.service';

function makeRepo(initial: any[] = []) {
  const rows: any[] = [...initial];
  const qb: any = {
    email: '',
    addSelect: () => qb,
    where: (_s: string, p: any) => ((qb.email = p.email), qb),
    getOne: async () => rows.find((r) => r.email === qb.email) ?? null,
  };
  return {
    rows,
    exists: jest.fn(async ({ where }: any) => rows.some((r) => r.email === where.email)),
    create: jest.fn((v: any) => ({ id: 'id-' + (rows.length + 1), ...v })),
    save: jest.fn(async (v: any) => (rows.push(v), v)),
    findOne: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
    createQueryBuilder: jest.fn(() => qb),
  };
}

describe('UsersService', () => {
  it('inscription publique : rôle client forcé, mot de passe haché, email normalisé', async () => {
    const repo = makeRepo();
    const svc = new UsersService(repo as any);
    const u: any = await svc.register({ email: 'A@B.com', password: 'secret123', firstName: 'A', lastName: 'B' });
    expect(u.role).toBe(Role.Client);
    expect(u.email).toBe('a@b.com');
    expect(u.passwordHash).toBeUndefined();
    expect(await bcrypt.compare('secret123', repo.rows[0].passwordHash)).toBe(true);
  });

  it('refuse un email déjà utilisé', async () => {
    const repo = makeRepo([{ email: 'a@b.com' }]);
    await expect(new UsersService(repo as any).register({ email: 'a@b.com', password: 'secret123', firstName: 'A', lastName: 'B' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('vérifie les identifiants et rejette un mauvais mot de passe ou un inconnu', async () => {
    const hash = await bcrypt.hash('good-password', 4);
    const repo = makeRepo([{ id: '1', email: 'a@b.com', passwordHash: hash, role: Role.Client, active: true }]);
    const svc = new UsersService(repo as any);
    await expect(svc.verifyCredentials('a@b.com', 'good-password')).resolves.toMatchObject({ id: '1', role: Role.Client });
    await expect(svc.verifyCredentials('a@b.com', 'bad')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.verifyCredentials('nobody@b.com', 'x')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('un client ne peut ni lire un autre utilisateur ni changer son rôle', async () => {
    const repo = makeRepo([{ id: '1', email: 'a@b.com' }, { id: '2', email: 'c@d.com' }]);
    const svc = new UsersService(repo as any);
    const client: AuthUser = { id: '1', role: Role.Client, scopes: [] };
    await expect(svc.findOne('2', client)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.update('1', { role: Role.Admin }, client)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
