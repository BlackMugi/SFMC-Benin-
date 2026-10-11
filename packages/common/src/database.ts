import { Logger } from '@nestjs/common';
import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';
import { DataSource, DataSourceOptions, MixedList } from 'typeorm';
import { env, envBool, envInt } from './config';

/** Verrou PostgreSQL pris pendant l'application des migrations : deux répliques qui démarrent ensemble ne migrent pas en parallèle. */
const MIGRATION_LOCK_ID = 726_354_001;
const MIGRATIONS_TABLE = 'migrations';

type MigrationList = MixedList<string | (new () => unknown)>;

/** Options de connexion : une base par service (variables DB_*). Requêtes toujours paramétrées par l'ORM. */
export function dataSourceOptions(migrations: MigrationList = []): DataSourceOptions {
  return {
    type: 'postgres',
    host: env('DB_HOST'),
    port: envInt('DB_PORT', 5432),
    database: env('DB_NAME'),
    username: env('DB_USER'),
    password: env('DB_PASSWORD'),
    // Le schéma est géré par les migrations versionnées (src/migrations). DB_SYNC=true reste possible en développement local uniquement.
    synchronize: envBool('DB_SYNC', false),
    migrations,
    migrationsTableName: MIGRATIONS_TABLE,
    migrationsTransactionMode: 'each',
  };
}

/**
 * Configuration TypeORM du service : connexion, puis application des migrations en attente avant que le service
 * accepte des requêtes. Les entités sont chargées automatiquement depuis les TypeOrmModule.forFeature().
 */
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
 * Applique les migrations en attente sous verrou consultatif PostgreSQL.
 * Base créée avant les migrations (ancien mode synchronize) : si les tables du service existent déjà et qu'aucune
 * migration n'est enregistrée, la migration initiale est marquée comme appliquée (baseline), sans toucher aux données.
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
  const tables = ds.entityMetadatas.filter((m) => m.tableType === 'regular').map((m) => m.tableName);
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

/** Les colonnes NUMERIC de PostgreSQL arrivent en string : conversion en number. */
export const numericTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? v : parseFloat(v)),
};
