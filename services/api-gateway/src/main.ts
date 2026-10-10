import { bootstrapService } from '@sfmc/common';
import { AppModule } from './app.module';

bootstrapService(AppModule, {
  serviceName: 'api-gateway',
  title: 'API Gateway - SFMC Bénin',
  description: 'Point d'entrée unique : routage via Consul, authentification JWT, rate limiting, CORS',
  bodyParser: false,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
