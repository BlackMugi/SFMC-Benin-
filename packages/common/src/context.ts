import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const CORRELATION_HEADER = 'x-correlation-id';

export function runWithContext<T>(correlationId: string | undefined, fn: () => T): T {
  return storage.run({ correlationId: correlationId || randomUUID() }, fn);
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
