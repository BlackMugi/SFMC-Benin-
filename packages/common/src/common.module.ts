import { DynamicModule, Global, Module, OnModuleInit, Inject } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth';
import { ConsulService } from './consul';
import { EventBus } from './event-bus';
import { HealthController } from './health.controller';
import { MetricsService } from './metrics';
import { SFMC_OPTIONS, SfmcOptions } from './options';
import { OAuthTokenProvider, ServiceClient, ServiceTokenProvider } from './service-client';

@Global()
@Module({})
export class CommonModule implements OnModuleInit {
  constructor(@Inject(SFMC_OPTIONS) private readonly options: SfmcOptions, private readonly bus: EventBus) {}

  /** Ouvre la connexion au broker au démarrage (sans bloquer si le service n'utilise pas d'événements). */
  async onModuleInit() {
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
        ServiceClient,
        OAuthTokenProvider,
        { provide: ServiceTokenProvider, useExisting: options.tokenProvider ?? OAuthTokenProvider },
        ...(options.tokenProvider ? [options.tokenProvider] : []),
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
      exports: [SFMC_OPTIONS, MetricsService, ConsulService, EventBus, ServiceClient, ServiceTokenProvider],
    };
  }
}
