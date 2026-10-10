import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { env, ServiceTokenProvider } from '@sfmc/common';

/**
 * auth-service signe lui-même son jeton de service (rôle "service", 60 s) pour appeler user-service.
 * Aucune dépendance Nest : ce provider est instancié par le CommonModule global.
 */
@Injectable()
export class LocalTokenProvider extends ServiceTokenProvider {
  private token?: string;
  private expiresAt = 0;

  async getToken(): Promise<string> {
    if (!this.token || Date.now() > this.expiresAt - 10_000) {
      this.token = jwt.sign({ typ: 'access', sub: 'auth-service', role: 'service' }, env('JWT_SECRET'), {
        algorithm: 'HS256',
        issuer: env('JWT_ISSUER', 'sfmc-auth'),
        expiresIn: 60,
      });
      this.expiresAt = Date.now() + 60_000;
    }
    return this.token;
  }
}
