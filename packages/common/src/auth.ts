import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { env } from './config';

export enum Role {
  Admin = 'admin',
  Operator = 'operator',
  Client = 'client',
  /** Compte machine interne (OAuth2 client credentials) */
  Service = 'service',
  /** Intégration externe (OAuth2 client credentials) */
  Partner = 'partner',
}

export interface AuthUser {
  id: string;
  role: Role;
  email?: string;
  scopes: string[];
}

export const IS_PUBLIC = 'isPublic';
export const ROLES_KEY = 'roles';
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** RBAC : sans @Roles, tout utilisateur authentifié passe. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

export function verifyAccessToken(token: string): AuthUser {
  const payload = jwt.verify(token, env('JWT_SECRET'), { issuer: env('JWT_ISSUER', 'sfmc-auth'), algorithms: ['HS256'] }) as jwt.JwtPayload;
  if (payload.typ !== 'access') throw new Error('type de jeton invalide');
  return {
    id: String(payload.sub),
    role: payload.role as Role,
    email: payload.email as string | undefined,
    scopes: ((payload.scope as string) || '').split(' ').filter(Boolean),
  };
}

export function extractBearer(header?: string): string | undefined {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  return m?.[1];
}

/** Guard global : vérifie le JWT (défense en profondeur, la Gateway l'a déjà vérifié) puis le rôle. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest();
    const token = extractBearer(req.headers.authorization);
    if (!token) throw new UnauthorizedException('Jeton manquant');
    try {
      req.user = verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException('Jeton invalide ou expiré');
    }
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    if (roles?.length && !roles.includes(req.user.role)) throw new ForbiddenException('Rôle insuffisant');
    return true;
  }
}
