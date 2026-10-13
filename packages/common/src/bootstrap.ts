import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { CORRELATION_HEADER, getCorrelationId, runWithContext } from './context';
import { ConsulService } from './consul';
import { envInt } from './config';
import { JsonLogger } from './logger';
import { MetricsService } from './metrics';

export interface BootstrapOptions {
  serviceName: string;
  title: string;
  description: string;
  consul?: boolean;
  /** false pour la gateway (le corps des requêtes est relayé tel quel). */
  bodyParser?: boolean;
  /** Hook avant le démarrage du serveur (middlewares supplémentaires). */
  configure?: (app: INestApplication) => void | Promise<void>;
}

export async function bootstrapService(module: unknown, opts: BootstrapOptions): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(module as never, { bodyParser: opts.bodyParser ?? true });
  app.useLogger(new JsonLogger(opts.serviceName));
  app.set('trust proxy', 1);

  // correlation-id : repris de l'en-tête ou généré
  app.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = req.headers[CORRELATION_HEADER];
    runWithContext(Array.isArray(incoming) ? incoming[0] : incoming, () => {
      res.setHeader(CORRELATION_HEADER, getCorrelationId()!);
      next();
    });
  });

  // helmet ; CSP assouplie pour l'UI Swagger
  const strict = helmet();
  const swaggerUi = helmet({ contentSecurityPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) => (req.path.startsWith('/docs') ? swaggerUi(req, res, next) : strict(req, res, next)));

  app.use(app.get(MetricsService).middleware());

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }));

  const doc = new DocumentBuilder().setTitle(opts.title).setDescription(opts.description).setVersion('1.0.0').addBearerAuth().build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));

  app.enableShutdownHooks();
  await opts.configure?.(app);

  const port = envInt('PORT', 3000);
  await app.listen(port, '0.0.0.0');
  new Logger(opts.serviceName).log(`${opts.serviceName} à l'écoute sur :${port} (Swagger : /docs)`);
  if (opts.consul !== false) await app.get(ConsulService).register();
  return app;
}
