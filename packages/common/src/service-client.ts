import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { env } from './config';
import { ConsulService } from './consul';
import { CORRELATION_HEADER, getCorrelationId } from './context';

export abstract class ServiceTokenProvider {
  abstract getToken(): Promise<string>;
}

/** OAuth2 client credentials : jeton de service obtenu auprès d'auth-service (via Consul). */
@Injectable()
export class OAuthTokenProvider extends ServiceTokenProvider {
  private readonly log = new Logger('ServiceToken');
  private token?: string;
  private expiresAt = 0;

  constructor(private readonly consul: ConsulService) {
    super();
  }

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - 30_000) return this.token;
    const base = await this.consul.resolve('auth-service');
    const res = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CORRELATION_HEADER]: getCorrelationId() ?? '' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: env('SERVICE_CLIENT_ID'), client_secret: env('SERVICE_CLIENT_SECRET') }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Obtention du jeton de service refusée (HTTP ${res.status})`);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    this.log.log('Jeton de service obtenu');
    return this.token;
  }
}

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
}

/** Client REST inter-services : Consul, jeton de service, correlation-id, timeout. */
@Injectable()
export class ServiceClient {
  constructor(private readonly consul: ConsulService, @Inject(ServiceTokenProvider) private readonly tokens: ServiceTokenProvider) {}

  async request<T = unknown>(service: string, method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const base = await this.consul.resolve(service);
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const token = await this.tokens.getToken();
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          [CORRELATION_HEADER]: getCorrelationId() ?? '',
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
      });
    } catch (e) {
      this.consul.invalidate(service);
      throw e;
    }
    const text = await res.text();
    const data = text ? safeJson(text) : undefined;
    if (!res.ok) throw new HttpException(data ?? { message: `${service} a répondu ${res.status}` }, res.status);
    return data as T;
  }

  get<T = unknown>(service: string, path: string, query?: RequestOptions['query']) {
    return this.request<T>(service, 'GET', path, { query });
  }

  post<T = unknown>(service: string, path: string, body?: unknown) {
    return this.request<T>(service, 'POST', path, { body });
  }
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
