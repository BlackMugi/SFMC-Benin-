import { Injectable } from '@nestjs/common';
import { ServiceTokenProvider, signAccessToken } from '@sfmc/common';

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
      this.token = signAccessToken({ sub: 'auth-service', role: 'service' }, 60);
      this.expiresAt = Date.now() + 60_000;
    }
    return this.token;
  }
}
