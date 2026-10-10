import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { env, envBool, envInt } from './config';

/** Configuration TypeORM : une base par service (variables DB_*). Requêtes toujours paramétrées par l'ORM. */
export function typeOrmConfig(): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: env('DB_HOST'),
    port: envInt('DB_PORT', 5432),
    database: env('DB_NAME'),
    username: env('DB_USER'),
    password: env('DB_PASSWORD'),
    autoLoadEntities: true,
    // synchronize : pratique pour la démo ; utiliser des migrations en production réelle.
    synchronize: envBool('DB_SYNC', true),
    retryAttempts: 20,
    retryDelay: 3000,
  };
}

/** Les colonnes NUMERIC de PostgreSQL arrivent en string : conversion en number. */
export const numericTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? v : parseFloat(v)),
};
