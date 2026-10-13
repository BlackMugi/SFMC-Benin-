import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { networkInterfaces, hostname } from 'node:os';
import { env, envInt } from './config';
import { SFMC_OPTIONS, SfmcOptions } from './options';

interface CacheEntry { urls: string[]; expires: number }

/** Enregistrement dans Consul et résolution des services (cache court, round-robin). */
@Injectable()
export class ConsulService implements OnApplicationShutdown {
  private readonly log = new Logger('Consul');
  private readonly base = `http://${env('CONSUL_HOST', 'consul')}:${envInt('CONSUL_PORT', 8500)}`;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly rr = new Map<string, number>();
  private serviceId?: string;

  constructor(@Inject(SFMC_OPTIONS) private readonly options: SfmcOptions) {}

  private address(): string {
    for (const list of Object.values(networkInterfaces())) {
      for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) return i.address;
    }
    return env('SERVICE_HOST', 'localhost');
  }

  async register(): Promise<void> {
    const port = envInt('PORT', 3000);
    const address = this.address();
    this.serviceId = `${this.options.serviceName}-${hostname()}`;
    const body = {
      ID: this.serviceId,
      Name: this.options.serviceName,
      Address: address,
      Port: port,
      Tags: ['sfmc', 'nestjs'],
      Check: {
        HTTP: `http://${address}:${port}/health`,
        Interval: '10s',
        Timeout: '3s',
        DeregisterCriticalServiceAfter: '1m',
      },
    };
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(`${this.base}/v1/agent/service/register`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.log.log(`Enregistré dans Consul : ${this.serviceId} (${address}:${port})`);
        return;
      } catch (e) {
        if (attempt >= 30) throw e;
        this.log.warn(`Consul indisponible (${(e as Error).message}), nouvel essai ${attempt}/30`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  async deregister(): Promise<void> {
    if (!this.serviceId) return;
    try {
      await fetch(`${this.base}/v1/agent/service/deregister/${encodeURIComponent(this.serviceId)}`, { method: 'PUT', signal: AbortSignal.timeout(2000) });
    } catch {
      /* Consul retirera l'instance via DeregisterCriticalServiceAfter */
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.deregister();
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/v1/status/leader`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Retourne l'URL de base (http://ip:port) d'une instance saine du service. */
  async resolve(service: string): Promise<string> {
    const now = Date.now();
    let entry = this.cache.get(service);
    if (!entry || entry.expires < now) {
      const res = await fetch(`${this.base}/v1/health/service/${encodeURIComponent(service)}?passing=true`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`Consul a répondu ${res.status}`);
      const nodes = (await res.json()) as { Service: { Address: string; Port: number } }[];
      entry = { urls: nodes.map((n) => `http://${n.Service.Address}:${n.Service.Port}`), expires: now + 5000 };
      this.cache.set(service, entry);
    }
    if (!entry.urls.length) throw new Error(`Aucune instance saine de ${service} dans Consul`);
    const i = (this.rr.get(service) ?? 0) % entry.urls.length;
    this.rr.set(service, i + 1);
    return entry.urls[i];
  }

  /** Retire une instance injoignable du cache sans attendre le prochain contrôle Consul. */
  markDown(service: string, url: string) {
    const entry = this.cache.get(service);
    if (entry) entry.urls = entry.urls.filter((u) => u !== url);
  }

  invalidate(service: string) {
    this.cache.delete(service);
  }
}
