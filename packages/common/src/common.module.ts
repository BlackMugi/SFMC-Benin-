import { DynamicModule, Global, Module, OnModuleInit, Inject } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth';
import { ConsulService } from './consul';
import { EventBus } from './event-bus';
import { hasSigningKey, Jwks, keyStore } from './jwks';
import { Outbox } from './outbox';
import { HealthController } from './health.controller';
import { MetricsService } from './metrics';
import { SFMC_OPTIONS, SfmcOptions } from './options';
import { OAuthTokenProvider, ServiceClient, ServiceTokenProvider } from './service-client';

@Global()
@Module({})
export class CommonModule implements OnModuleInit {
  constructor(
    @Inject(SFMC_OPTIONS) private readonly options: SfmcOptions,
    private readonly bus: EventBus,
    private readonly consul: ConsulService,
  ) {}

  /** Ouvre la connexion au broker au démarrage. */
  async onModuleInit() {
    // Clés publiques : récupérées chez auth-service via Consul (sauf pour auth-service lui-même)
    if (!hasSigningKey()) {
      keyStore.setResolver(async () => {
        const base = await this.consul.resolve('auth-service');
        const res = await fetch(`${base}/oauth/jwks`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) throw new Error(`JWKS indisponible (HTTP ${res.status})`);
        return (await res.json()) as Jwks;
      });
    }
    if (this.options.events !== false) await this.bus.connect();
  }

  static forRoot(options: SfmcOptions): DynamicModule {
    return {
      module: CommonModule,
      controllers: [HealthController],
      providers: [
        { provide: SFMC_OPTIONS, useValue: options },
        { provide: MetricsService, useFactory: () => new MetricsService(options.serviceName) },
        ConsulService,
        EventBus,
        Outbox,
        ServiceClient,
        OAuthTokenProvider,
        { provide: ServiceTokenProvider, useExisting: options.tokenProvider ?? OAuthTokenProvider },
        ...(options.tokenProvider ? [options.tokenProvider] : []),
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
      exports: [SFMC_OPTIONS, MetricsService, ConsulService, EventBus, Outbox, ServiceClient, ServiceTokenProvider],
    };
  }
}
