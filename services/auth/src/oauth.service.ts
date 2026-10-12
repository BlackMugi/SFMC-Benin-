import { Injectable, Logger, NotFoundException, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OAuthClient } from './oauth-client.entity';
import { TokensService } from './tokens.service';

@Injectable()
export class OAuthService implements OnModuleInit {
  private readonly log = new Logger(OAuthService.name);

  constructor(@InjectRepository(OAuthClient) private readonly repo: Repository<OAuthClient>, private readonly tokens: TokensService) {}

  /** Clients pré-enregistrés depuis l'environnement (aucun secret en dur). */
  async onModuleInit() {
    await this.seed('order-service', 'Order Service', 'service', process.env.ORDER_CLIENT_SECRET, ['internal']);
    await this.seed('partner-demo', 'Partenaire de démonstration', 'partner', process.env.PARTNER_DEMO_CLIENT_SECRET, ['catalog:read']);
  }

  private async seed(clientId: string, name: string, role: 'service' | 'partner', secret: string | undefined, scopes: string[]) {
    if (!secret) return;
    const secretHash = this.tokens.hash(secret);
    const existing = await this.repo.findOne({ where: { clientId } });
    if (existing) {
      if (existing.secretHash !== secretHash) await this.repo.update(existing.id, { secretHash });
      return;
    }
    await this.repo.save(this.repo.create({ clientId, name, role, scopes, secretHash }));
    this.log.log(`Client OAuth2 créé : ${clientId} (${role})`);
  }

  /** Flux OAuth2 client credentials (RFC 6749 §4.4). */
  async clientCredentials(clientId: string, clientSecret: string, requestedScope?: string) {
    const client = await this.repo.findOne({ where: { clientId } });
    const ok = !!client && client.active && this.tokens.safeEqual(client.secretHash, this.tokens.hash(clientSecret));
    if (!ok) throw new UnauthorizedException('invalid_client');
    // Le scope demandé est restreint aux scopes accordés au client.
    const requested = requestedScope?.split(' ').filter(Boolean) ?? client.scopes;
    const scopes = requested.filter((s) => client.scopes.includes(s));
    const ttl = this.tokens.accessTtl;
    return {
      access_token: this.tokens.signAccess({ sub: client.clientId, role: client.role, scope: scopes.join(' ') }, ttl),
      token_type: 'Bearer',
      expires_in: ttl,
      scope: scopes.join(' '),
    };
  }

  /** RFC 7662 */
  async introspect(token: string) {
    try {
      const p = await this.tokens.verify(token);
      return { active: true, sub: p.sub, role: p.role, email: p.email, scope: p.scope, exp: p.exp, iss: p.iss };
    } catch {
      return { active: false };
    }
  }

  async createClient(name: string, scopes: string[] = []) {
    const clientId = `ext-${this.tokens.randomToken(9)}`;
    const clientSecret = this.tokens.randomToken(32);
    const c = await this.repo.save(this.repo.create({ clientId, name, role: 'partner', scopes, secretHash: this.tokens.hash(clientSecret) }));
    // Le secret n'est renvoyé qu'une seule fois.
    return { id: c.id, clientId, clientSecret, name, role: c.role, scopes: c.scopes };
  }

  async list() {
    const all = await this.repo.find({ order: { createdAt: 'ASC' } });
    return all.map(({ secretHash: _s, ...c }) => c);
  }

  async remove(id: string) {
    const res = await this.repo.delete(id);
    if (!res.affected) throw new NotFoundException('Client introuvable');
  }
}
