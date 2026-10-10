import { bootstrapService } from '@sfmc/common';
import { AppModule } from './app.module';

bootstrapService(AppModule, {
  serviceName: 'production-service',
  title: 'Production Service - SFMC Bénin',
  description: 'Planification, machines, suivi temps réel (SSE)',
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
