import { Logger } from '@nestjs/common';
import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';
import { DataSource, DataSourceOptions, MixedList } from 'typeorm';
import { env, envBool, envInt } from './config';

/** Verrou PostgreSQL pendant les migrations : deux répliques ne migrent pas en parallèle. */
const MIGRATION_LOCK_ID = 726_354_001;
const MIGRATIONS_TABLE = 'migrations';

type MigrationList = MixedList<string | (new () => unknown)>;

/** Options de connexion, une base par service (variables DB_*). */
export function dataSourceOptions(migrations: MigrationList = []): DataSourceOptions {
  return {
    type: 'postgres',
    host: env('DB_HOST'),
    port: envInt('DB_PORT', 5432),
    database: env('DB_NAME'),
    username: env('DB_USER'),
    password: env('DB_PASSWORD'),
    // Schéma géré par les migrations (src/migrations). DB_SYNC=true réservé au développement local.
    synchronize: envBool('DB_SYNC', false),
    migrations,
    migrationsTableName: MIGRATIONS_TABLE,
    migrationsTransactionMode: 'each',
  };
}

/** Configuration TypeORM : connexion, puis migrations en attente avant d'accepter des requêtes. */
export function typeOrmConfig(migrations: MigrationList = []): TypeOrmModuleAsyncOptions {
  return {
    useFactory: () => ({ ...dataSourceOptions(migrations), autoLoadEntities: true, retryAttempts: 20, retryDelay: 3000 }),
    dataSourceFactory: async (options) => {
      const ds = await new DataSource(options!).initialize();
      await runMigrations(ds);
      return ds;
    },
  };
}

/**
 * Applique les migrations en attente sous verrou PostgreSQL.
 * Si la base a été créée par synchronize (tables présentes, aucune migration enregistrée), la migration
 * initiale est marquée comme appliquée sans toucher aux données.
 */
export async function runMigrations(ds: DataSource): Promise<void> {
  const log = new Logger('Migrations');
  const qr = ds.createQueryRunner();
  await qr.connect();
  try {
    await qr.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await baselineLegacySchema(ds, log);
    const applied = await ds.runMigrations({ transaction: 'each' });
    for (const m of applied) log.log(`Migration appliquée : ${m.name}`);
  } finally {
    await qr.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    await qr.release();
  }
}

async function baselineLegacySchema(ds: DataSource, log: Logger) {
  const initial = ds.migrations[0];
  if (!initial) return;
  const [{ exists: hasMigrationsTable }] = await ds.query(`SELECT to_regclass($1) IS NOT NULL AS exists`, [`public.${MIGRATIONS_TABLE}`]);
  if (hasMigrationsTable) return;
  // Tables d'avant les migrations (outbox et déduplication sont venues après)
  const later = new Set(['outbox', 'processed_events']);
  const tables = ds.entityMetadatas.filter((m) => m.tableType === 'regular' && !later.has(m.tableName)).map((m) => m.tableName);
  if (!tables.length) return;
  const [{ count }] = await ds.query(`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`, [tables]);
  if (count === 0) return; // base vide : la migration initiale va tout créer
  if (count !== tables.length) throw new Error(`Schéma partiel détecté (${count}/${tables.length} tables) : baseline impossible, intervention manuelle requise`);
  const name = initial.name ?? initial.constructor.name;
  const timestamp = Number(/(\d{13})$/.exec(name)?.[1]);
  await ds.query(`CREATE TABLE "${MIGRATIONS_TABLE}" ("id" SERIAL NOT NULL, "timestamp" bigint NOT NULL, "name" character varying NOT NULL, CONSTRAINT "PK_${MIGRATIONS_TABLE}" PRIMARY KEY ("id"))`);
  await ds.query(`INSERT INTO "${MIGRATIONS_TABLE}" ("timestamp", "name") VALUES ($1, $2)`, [timestamp, name]);
  log.warn(`Base existante sans historique de migrations : ${name} marquée comme appliquée (baseline)`);
}

/** NUMERIC arrive en string depuis PostgreSQL : conversion en number. */
export const numericTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? v : parseFloat(v)),
};
