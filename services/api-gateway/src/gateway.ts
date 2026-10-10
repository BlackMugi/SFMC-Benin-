import { INestApplication, Logger } from '@nestjs/common';
import { createProxyMiddleware } from 'http-proxy-middleware';
import rateLimit from 'express-rate-limit';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ConsulService, CORRELATION_HEADER, env, envInt, extractBearer, getCorrelationId, verifyAccessToken } from '@sfmc/common';
import { BLOCKED, isPublic, pathOf, serviceFor } from './routes';

const log = new Logger('Gateway');

type GatewayRequest = Request & { sfmcTarget?: string; sfmcRetried?: boolean };

const isStream = (url: string) => url.startsWith('/api/production/stream');

/** Erreurs réseau signalant une instance morte (et non une erreur applicative). */
const DEAD_INSTANCE = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENOTFOUND', 'EPIPE']);

function json(res: Response, status: number, message: string) {
  res.status(status).json({ statusCode: status, message });
}

/** Branche CORS, rate limiting, authentification JWT centralisée et proxy dynamique (Consul). */
export function setupGateway(app: INestApplication) {
  const consul = app.get(ConsulService);

  // --- CORS : origines autorisées explicitement (pas de wildcard) ---
  const origins = env('CORS_ORIGINS', '').split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({
    origin: origins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', CORRELATION_HEADER],
    exposedHeaders: [CORRELATION_HEADER, 'RateLimit-Limit', 'RateLimit-Remaining'],
    maxAge: 600,
  });

  // --- Rate limiting : global par IP, plus strict sur les points d'authentification (anti brute-force) ---
  const limitOpts = { windowMs: 60_000, standardHeaders: 'draft-7' as const, legacyHeaders: false, message: { statusCode: 429, message: 'Trop de requêtes, réessayez plus tard' } };
  const globalLimiter = rateLimit({ ...limitOpts, limit: envInt('GATEWAY_RATE_LIMIT', 300) });
  const authLimiter = rateLimit({ ...limitOpts, limit: envInt('GATEWAY_AUTH_RATE_LIMIT', 30) });
  app.use('/api', globalLimiter);
  app.use(['/api/auth', '/api/oauth', '/api/users/register'], authLimiter);

  // --- Garde-fous + authentification centralisée ---
  app.use('/api', (req: GatewayRequest, res: Response, next: NextFunction) => {
    const url = req.originalUrl;
    // L'identité est exclusivement fournie par la gateway : on retire tout en-tête x-user-* du client.
    for (const h of Object.keys(req.headers)) if (h.startsWith('x-user-')) delete req.headers[h];
    if (BLOCKED.test(pathOf(url))) return json(res, 403, 'Accès interdit');
    if (!serviceFor(url)) return json(res, 404, 'Route inconnue');
    req.headers[CORRELATION_HEADER] = getCorrelationId();
    if (req.method === 'OPTIONS' || isPublic(req.method, url)) return next();

    const token = extractBearer(req.headers.authorization);
    if (!token) return json(res, 401, 'Authentification requise');
    try {
      const user = verifyAccessToken(token);
      // Identité propagée aux services (qui revérifient aussi le JWT)
      req.headers['x-user-id'] = user.id;
      req.headers['x-user-role'] = user.role;
      if (user.email) req.headers['x-user-email'] = user.email;
    } catch {
      return json(res, 401, 'Jeton invalide ou expiré');
    }
    next();
  });

  // --- Résolution du service via Consul ---
  app.use('/api', async (req: GatewayRequest, res: Response, next: NextFunction) => {
    const service = serviceFor(req.originalUrl)!;
    try {
      req.sfmcTarget = await consul.resolve(service);
      // étiquette de métrique : /api/<segment>
      (req as any).route = { path: '/' + req.originalUrl.split('/')[2].split('?')[0] };
      next();
    } catch (e) {
      log.error(`Service ${service} indisponible : ${(e as Error).message}`);
      json(res, 503, `Service ${service} indisponible`);
    }
  });

  // Timeout court pour les requêtes classiques (une instance morte est détectée vite et la lecture rejouée) ;
  // long pour le flux SSE de production, qui peut rester ouvert indéfiniment (heartbeat toutes les 15 s).
  const buildProxy = (timeoutMs: number): RequestHandler => createProxyMiddleware<GatewayRequest, Response>({
    target: 'http://placeholder.invalid',
    changeOrigin: true,
    xfwd: true,
    proxyTimeout: timeoutMs,
    timeout: timeoutMs + 5_000, // doit dépasser proxyTimeout : sinon la socket client est coupée avant que l'erreur soit traitée (et la lecture rejouée)
    router: (req) => req.sfmcTarget!,
    pathRewrite: (_path, req) => req.originalUrl.replace(/^\/api/, ''),
    on: {
      error: async (err, req, res) => {
        const gr = req as GatewayRequest;
        const service = serviceFor(gr.originalUrl);
        const r = res as Response;
        // Instance morte : on l'écarte du cache, et une requête de lecture est rejouée sur une autre instance.
        if (service && gr.sfmcTarget && DEAD_INSTANCE.has((err as NodeJS.ErrnoException).code ?? '')) {
          consul.markDown(service, gr.sfmcTarget);
          if (!gr.sfmcRetried && ['GET', 'HEAD'].includes(gr.method) && !r.headersSent) {
            gr.sfmcRetried = true;
            try {
              gr.sfmcTarget = await consul.resolve(service);
              log.warn(`Instance injoignable (${(err as Error).message}) : nouvel essai sur ${gr.sfmcTarget}`);
              return void (isStream(gr.originalUrl) ? streamProxy : proxy)(gr, r, () => undefined);
            } catch {
              /* plus aucune instance saine : réponse 502 ci-dessous */
            }
          }
        }
        log.error(`Erreur de proxy : ${(err as Error).message}`);
        if (!r.headersSent && typeof r.status === 'function') r.status(502).json({ statusCode: 502, message: 'Service injoignable' });
      },
    },
  });
  const proxy = buildProxy(envInt('GATEWAY_PROXY_TIMEOUT_MS', 10_000));
  const streamProxy = buildProxy(3_600_000);
  app.use('/api', (req: Request, res: Response, next: NextFunction) => (isStream(req.originalUrl) ? streamProxy : proxy)(req, res, next));
}
