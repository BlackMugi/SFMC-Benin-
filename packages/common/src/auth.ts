import { CanActivate, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { KeysUnavailableError, verifyJwt } from './jwks';

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
/** Sans @Roles, tout utilisateur authentifié passe. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

/** Vérifie un jeton RS256 avec la clé publique d'auth-service. */
export async function verifyAccessToken(token: string): Promise<AuthUser> {
  const payload = await verifyJwt(token);
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

/** Guard global : vérifie le JWT puis le rôle. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest();
    const token = extractBearer(req.headers.authorization);
    if (!token) throw new UnauthorizedException('Jeton manquant');
    try {
      req.user = await verifyAccessToken(token);
    } catch (e) {
      if (e instanceof KeysUnavailableError) throw new ServiceUnavailableException('Vérification des jetons momentanément indisponible');
      throw new UnauthorizedException('Jeton invalide ou expiré');
    }
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    if (roles?.length && !roles.includes(req.user.role)) throw new ForbiddenException('Rôle insuffisant');
    return true;
  }
}
