import { Controller, Get, Header, Inject, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ModuleRef } from '@nestjs/core';
import { DataSource } from 'typeorm';
import type { Response } from 'express';
import { Public } from './auth';
import { ConsulService } from './consul';
import { EventBus } from './event-bus';
import { MetricsService } from './metrics';
import { SFMC_OPTIONS, SfmcOptions } from './options';

@ApiExcludeController()
@Controller()
export class HealthController {
  constructor(
    @Inject(SFMC_OPTIONS) private readonly options: SfmcOptions,
    private readonly moduleRef: ModuleRef,
    private readonly metrics: MetricsService,
  ) {}

  @Public()
  @Get('health')
  async health(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, string> = {};
    let ds: DataSource | undefined;
    try {
      ds = this.moduleRef.get(DataSource, { strict: false });
    } catch {
      /* service sans base (gateway) */
    }
    if (ds) {
      try {
        await ds.query('SELECT 1');
        checks.database = 'up';
      } catch {
        checks.database = 'down';
      }
    }
    let outboxPending: number | undefined;
    if (this.options.events !== false) {
      checks.broker = this.moduleRef.get(EventBus, { strict: false }).isConnected() ? 'up' : 'down';
      if (ds && checks.database === 'up') {
        try {
          const [row] = await ds.query('SELECT count(*)::int AS n FROM outbox WHERE published_at IS NULL');
          outboxPending = row.n;
        } catch {
          /* table absente : service sans outbox */
        }
      }
    }
    if (this.options.consul !== false) {
      checks.consul = (await this.moduleRef.get(ConsulService, { strict: false }).ping()) ? 'up' : 'down';
    }
    // Seule la base est bloquante. Sans broker le service reste disponible (les événements attendent dans
    // l'outbox) mais passe en « degraded ». Consul est surveillé sans bloquer.
    if (checks.database === 'down') res.status(503);
    const status = checks.database === 'down' ? 'down' : Object.values(checks).includes('down') ? 'degraded' : 'ok';
    return { status, service: this.options.serviceName, uptime: Math.round(process.uptime()), checks, ...(outboxPending !== undefined ? { outboxPending } : {}) };
  }

  @Public()
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  metricsEndpoint() {
    return this.metrics.registry.metrics();
  }
}
