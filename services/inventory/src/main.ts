import { bootstrapService } from '@sfmc/common';
import { AppModule } from './app.module';

bootstrapService(AppModule, {
  serviceName: 'inventory-service',
  title: 'Inventory Service - SFMC Bénin',
  description: 'Stocks multi-entrepôts, mouvements, seuil critique, réservations',
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
