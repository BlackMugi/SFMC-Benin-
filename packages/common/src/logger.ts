import { LoggerService } from '@nestjs/common';
import { getCorrelationId } from './context';

const LEVELS = ['debug', 'log', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

/** Logger JSON structuré (une ligne par entrée) avec correlation-id issu du contexte asynchrone. */
export class JsonLogger implements LoggerService {
  private readonly min: number;

  constructor(private readonly service: string, level = process.env.LOG_LEVEL || 'info') {
    const normalized = level === 'info' ? 'log' : level;
    this.min = Math.max(0, LEVELS.indexOf(normalized as Level));
  }

  private write(level: Level, message: unknown, optional: unknown[]) {
    if (LEVELS.indexOf(level) < this.min) return;
    const last = optional[optional.length - 1];
    const context = typeof last === 'string' ? last : undefined;
    const extra = optional.filter((o) => typeof o === 'object' && o !== null);
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level: level === 'log' ? 'info' : level,
      service: this.service,
      correlationId: getCorrelationId(),
      context,
      msg: message instanceof Error ? message.message : message,
    };
    if (message instanceof Error) entry.stack = message.stack;
    if (extra.length) Object.assign(entry, ...extra);
    (level === 'error' ? process.stderr : process.stdout).write(JSON.stringify(entry) + '\n');
  }

  log(message: unknown, ...optional: unknown[]) { this.write('log', message, optional); }
  error(message: unknown, ...optional: unknown[]) { this.write('error', message, optional); }
  warn(message: unknown, ...optional: unknown[]) { this.write('warn', message, optional); }
  debug(message: unknown, ...optional: unknown[]) { this.write('debug', message, optional); }
  verbose(message: unknown, ...optional: unknown[]) { this.write('debug', message, optional); }
}
