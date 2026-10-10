import { bootstrapService } from '@sfmc/common';
import { AppModule } from './app.module';

bootstrapService(AppModule, {
  serviceName: 'user-service',
  title: 'User Service - SFMC Bénin',
  description: 'CRUD utilisateurs et rôles (admin, operator, client)',
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
