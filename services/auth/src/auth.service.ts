import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { ServiceClient } from '@sfmc/common';
import { RefreshToken } from './refresh-token.entity';
import { TokensService } from './tokens.service';

interface UserIdentity {
  id: string;
  email: string;
  role: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(RefreshToken) private readonly refreshRepo: Repository<RefreshToken>,
    private readonly tokens: TokensService,
    private readonly services: ServiceClient,
  ) {}

  async login(email: string, password: string) {
    // REST interne vers user-service (vérification des identifiants)
    const user = await this.services
      .post<UserIdentity>('user-service', '/users/internal/verify', { email, password })
      .catch((e) => {
        if (e?.getStatus?.() === 401) throw new UnauthorizedException('Identifiants invalides');
        throw e;
      });
    return this.issue(user, randomUUID());
  }

  async refresh(refreshToken: string) {
    const stored = await this.refreshRepo.findOne({ where: { tokenHash: this.tokens.hash(refreshToken) } });
    if (!stored) throw new UnauthorizedException('Jeton de rafraîchissement invalide');
    if (stored.revokedAt) {
      // Jeton déjà consommé réutilisé : compromission probable, toute la famille est révoquée.
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('Jeton de rafraîchissement réutilisé');
    }
    if (stored.expiresAt.getTime() < Date.now()) throw new UnauthorizedException('Jeton de rafraîchissement expiré');
    const user = await this.services.get<UserIdentity>('user-service', `/users/internal/${stored.userId}`).catch(() => {
      throw new UnauthorizedException('Utilisateur inactif ou supprimé');
    });
    stored.revokedAt = new Date();
    await this.refreshRepo.save(stored);
    return this.issue(user, stored.familyId);
  }

  async logout(refreshToken: string): Promise<void> {
    const stored = await this.refreshRepo.findOne({ where: { tokenHash: this.tokens.hash(refreshToken) } });
    if (stored) await this.revokeFamily(stored.familyId);
  }

  private revokeFamily(familyId: string) {
    return this.refreshRepo.update({ familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  private async issue(user: UserIdentity, familyId: string) {
    const refreshToken = this.tokens.randomToken();
    await this.refreshRepo.save(
      this.refreshRepo.create({
        userId: user.id,
        familyId,
        tokenHash: this.tokens.hash(refreshToken),
        expiresAt: new Date(Date.now() + this.tokens.refreshTtlMs),
        revokedAt: null,
      }),
    );
    return {
      accessToken: this.tokens.signAccess({ sub: user.id, role: user.role, email: user.email }),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.tokens.accessTtl,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }
}
