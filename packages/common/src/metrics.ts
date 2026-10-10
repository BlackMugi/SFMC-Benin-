import { Injectable } from '@nestjs/common';
import { Registry, collectDefaultMetrics, Histogram, Counter } from 'prom-client';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpDuration: Histogram<string>;
  readonly eventsPublished: Counter<string>;
  readonly eventsConsumed: Counter<string>;
  readonly eventsFailed: Counter<string>;

  constructor(serviceName: string) {
    this.registry.setDefaultLabels({ service: serviceName });
    collectDefaultMetrics({ register: this.registry });
    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Durée des requêtes HTTP',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.registry],
    });
    this.eventsPublished = new Counter({ name: 'sfmc_events_published_total', help: 'Événements publiés', labelNames: ['type'], registers: [this.registry] });
    this.eventsConsumed = new Counter({ name: 'sfmc_events_consumed_total', help: 'Événements consommés', labelNames: ['type'], registers: [this.registry] });
    this.eventsFailed = new Counter({ name: 'sfmc_events_failed_total', help: 'Événements en échec (dead-letter)', labelNames: ['type'], registers: [this.registry] });
  }

  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      if (req.path === '/metrics') return next();
      const end = this.httpDuration.startTimer();
      res.on('finish', () => {
        // Route normalisée (le motif Express, pas l'URL brute) : évite l'explosion de cardinalité.
        const pattern = req.route?.path as string | undefined;
        const route = pattern ? (req.baseUrl || '') + pattern : 'unmatched';
        end({ method: req.method, route, status: String(res.statusCode) });
      });
      next();
    };
  }
}
