import { bootstrapService } from '@sfmc/common';
import { AppModule } from './app.module';

bootstrapService(AppModule, {
  serviceName: 'billing-service',
  title: 'Billing Service - SFMC Bénin',
  description: 'Facturation et paiement',
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
