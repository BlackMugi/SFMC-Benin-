import { bootstrapService } from '@sfmc/common';
import { AppModule } from './app.module';

bootstrapService(AppModule, {
  serviceName: 'order-service',
  title: 'Order Service - SFMC Bénin',
  description: 'Cycle de vie des commandes et saga de commande',
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
