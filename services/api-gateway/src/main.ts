import { bootstrapService } from '@sfmc/common';
import { AppModule } from './app.module';
import { setupGateway } from './gateway';

bootstrapService(AppModule, {
  serviceName: 'api-gateway',
  title: 'API Gateway - SFMC Bénin',
  description: "Point d'entrée unique : routage dynamique via Consul, authentification JWT, rate limiting, CORS. Les APIs métier sont exposées sous /api/<ressource>.",
  bodyParser: false,
  configure: setupGateway,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
