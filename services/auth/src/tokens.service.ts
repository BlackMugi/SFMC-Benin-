import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env, envInt } from '@sfmc/common';

export interface AccessClaims {
  sub: string;
  role: string;
  email?: string;
  scope?: string;
}

@Injectable()
export class TokensService {
  get accessTtl(): number {
    return envInt('JWT_ACCESS_TTL', 900);
  }

  get refreshTtlMs(): number {
    return envInt('JWT_REFRESH_TTL_DAYS', 7) * 86_400_000;
  }

  signAccess(claims: AccessClaims, ttlSeconds = this.accessTtl): string {
    return jwt.sign({ ...claims, typ: 'access' }, env('JWT_SECRET'), { algorithm: 'HS256', issuer: env('JWT_ISSUER', 'sfmc-auth'), expiresIn: ttlSeconds });
  }

  verify(token: string): jwt.JwtPayload {
    return jwt.verify(token, env('JWT_SECRET'), { issuer: env('JWT_ISSUER', 'sfmc-auth'), algorithms: ['HS256'] }) as jwt.JwtPayload;
  }

  /** Jeton opaque à forte entropie (refresh token, secret client). */
  randomToken(bytes = 48): string {
    return randomBytes(bytes).toString('base64url');
  }

  hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /** Comparaison à temps constant de deux empreintes hexadécimales. */
  safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
