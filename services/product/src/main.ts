import { bootstrapService } from '@sfmc/common';
import { AppModule } from './app.module';

bootstrapService(AppModule, {
  serviceName: 'product-service',
  title: 'Product Service - SFMC Bénin',
  description: 'Catalogue produits (ciment, fer, briques, granulats)',
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
