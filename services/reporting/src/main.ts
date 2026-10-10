import { bootstrapService } from '@sfmc/common';
import { AppModule } from './app.module';

bootstrapService(AppModule, {
  serviceName: 'reporting-service',
  title: 'Reporting Service - SFMC Bénin',
  description: 'Vues de lecture agrégées (ventes, stocks, production)',
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
