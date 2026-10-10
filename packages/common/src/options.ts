import type { Type } from '@nestjs/common';
import type { ServiceTokenProvider } from './service-client';

export const SFMC_OPTIONS = 'SFMC_OPTIONS';

export interface SfmcOptions {
  /** Nom enregistré dans Consul, ex. "order-service" */
  serviceName: string;
  /** Connexion RabbitMQ (défaut : true) */
  events?: boolean;
  /** Enregistrement Consul (défaut : true) */
  consul?: boolean;
  /** Remplace le fournisseur de jeton inter-services (ex. auth-service signe localement) */
  tokenProvider?: Type<ServiceTokenProvider>;
}
