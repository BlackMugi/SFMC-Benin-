import { bootstrapService } from '@sfmc/common';
import { AppModule } from './app.module';

bootstrapService(AppModule, {
  serviceName: 'notification-service',
  title: 'Notification Service - SFMC Bénin',
  description: 'Notifications email/log pilotées par les événements',
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
