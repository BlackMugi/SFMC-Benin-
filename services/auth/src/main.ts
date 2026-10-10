import { bootstrapService } from '@sfmc/common';
import { AppModule } from './app.module';

bootstrapService(AppModule, {
  serviceName: 'auth-service',
  title: 'Auth Service - SFMC Bénin',
  description: 'Authentification JWT (access + refresh), OAuth2 client credentials, sécurité inter-services',
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
