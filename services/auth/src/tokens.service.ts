import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { envInt, signAccessToken, verifyJwt } from '@sfmc/common';

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

  /** Signature RS256 avec la clé privée (seul auth-service la possède). */
  signAccess(claims: AccessClaims, ttlSeconds = this.accessTtl): string {
    return signAccessToken({ ...claims }, ttlSeconds);
  }

  verify(token: string): Promise<jwt.JwtPayload> {
    return verifyJwt(token);
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
