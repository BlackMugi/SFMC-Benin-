// Outils communs aux scripts de migration : base PostgreSQL jetable (Docker) et chargement des entités compilées d'un service.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

/** Services qui possèdent une base (la gateway n'en a pas). */
export const SERVICES_WITH_DB = ['auth', 'user', 'product', 'inventory', 'order', 'production', 'billing', 'notification', 'reporting'];

const PG_IMAGE = 'postgres:16-alpine'; // même image que docker-compose.yml

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Démarre un PostgreSQL jetable, appelle fn(connect) puis supprime le conteneur.
 * connect(dbName) crée la base (si besoin) et renvoie les options de connexion TypeORM.
 */
export async function withTempPostgres(fn) {
  const name = `sfmc-migrations-${randomBytes(4).toString('hex')}`;
  const password = randomBytes(12).toString('hex');
  docker('run', '-d', '--rm', '--name', name, '-e', `POSTGRES_PASSWORD=${password}`, '-p', '127.0.0.1::5432', PG_IMAGE);
  try {
    const port = Number(docker('port', name, '5432/tcp').split('\n')[0].split(':').pop());
    for (let i = 0; ; i++) {
      try {
        docker('exec', name, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1');
        break;
      } catch {
        if (i > 60) throw new Error('PostgreSQL jetable : démarrage trop long');
        await sleep(500);
      }
    }
    await sleep(1000); // pg_isready répond avant la fin de l'initialisation de l'image officielle
    const base = { type: 'postgres', host: '127.0.0.1', port, username: 'postgres', password };
    const connect = async (db) => {
      docker('exec', name, 'psql', '-U', 'postgres', '-tc', `SELECT 1 FROM pg_database WHERE datname='${db}'`).includes('1') ||
        docker('exec', name, 'psql', '-U', 'postgres', '-c', `CREATE DATABASE "${db}"`);
      return { ...base, database: db };
    };
    return await fn(connect);
  } finally {
    try {
      docker('rm', '-f', name);
    } catch {
      /* déjà supprimé */
    }
  }
}

/** Charge typeorm, les entités et les migrations compilées (dist) d'un service. */
export async function loadService(service) {
  const dir = resolve('services', service);
  const dist = resolve(dir, 'dist');
  if (!existsSync(dist)) throw new Error(`${service} n'est pas compilé : lancer npm run build -w @sfmc/${service}`);
  const require = createRequire(resolve(dir, 'package.json'));
  const typeorm = require('typeorm');
  const storage = typeorm.getMetadataArgsStorage();
  const entities = new Set();
  for (const f of readdirSync(dist).filter((f) => /entit.*\.js$/i.test(f))) {
    for (const exp of Object.values(require(resolve(dist, f)))) {
      if (typeof exp === 'function' && storage.tables.some((t) => t.target === exp)) entities.add(exp);
    }
  }
  // Entités communes (outbox, déduplication) déclarées par le module du service
  if (readFileSync(resolve(dist, 'app.module.js'), 'utf8').includes('OUTBOX_ENTITIES')) {
    for (const e of require('@sfmc/common').OUTBOX_ENTITIES) entities.add(e);
  }
  const index = resolve(dist, 'migrations', 'index.js');
  const migrations = existsSync(index) ? require(index).MIGRATIONS : [];
  return { DataSource: typeorm.DataSource, entities: [...entities], migrations };
}
