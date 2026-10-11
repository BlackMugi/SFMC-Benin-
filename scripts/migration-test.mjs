// Test des migrations de chaque service sur un PostgreSQL jetable (Docker) :
//  1. base vide -> up : toutes les migrations passent
//  2. le schéma obtenu correspond exactement aux entités (aucune différence détectée par TypeORM)
//  3. down jusqu'au bout : plus aucune table métier ; puis up à nouveau
//  4. baseline : une base créée par l'ancien mode synchronize est reprise sans perte (migration initiale marquée appliquée)
// Usage : npm run build && npm run test:migrations
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { withTempPostgres, loadService, SERVICES_WITH_DB } from './lib/migrations.mjs';

const { runMigrations } = createRequire(resolve('packages/common/package.json'))('./dist/index.js');
const results = [];
let failed = false;
const check = (service, label, ok, detail = '') => {
  results.push(`${ok ? 'OK  ' : 'ECHEC'} ${service.padEnd(13)} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failed = true;
};

const businessTables = async (ds) =>
  (await ds.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name <> 'migrations'`)).map((r) => r.table_name);

await withTempPostgres(async (connect) => {
  for (const service of SERVICES_WITH_DB) {
    const { DataSource, entities, migrations } = await loadService(service);
    check(service, 'migrations présentes', migrations.length > 0, `${migrations.length}`);

    // 1-3 : base vide
    const ds = new DataSource({ ...(await connect(`${service}_fresh`)), entities, migrations, migrationsTableName: 'migrations' });
    await ds.initialize();
    try {
      const applied = await ds.runMigrations({ transaction: 'each' });
      check(service, 'up sur base vide', applied.length === migrations.length, `${applied.length} appliquée(s)`);
      const drift = (await ds.driver.createSchemaBuilder().log()).upQueries;
      check(service, 'schéma = entités', drift.length === 0, drift.map((q) => q.query.slice(0, 80)).join(' | '));
      for (let i = 0; i < migrations.length; i++) await ds.undoLastMigration({ transaction: 'each' });
      const left = await businessTables(ds);
      check(service, 'down complet', left.length === 0, left.join(', '));
      const again = await ds.runMigrations({ transaction: 'each' });
      check(service, 'up après down', again.length === migrations.length);
    } finally {
      await ds.destroy();
    }

    // 4 : base existante créée par synchronize (comme avant les migrations) avec un marqueur de données
    const legacyEntities = entities.filter((e) => !['OutboxEvent', 'ProcessedEvent'].includes(e.name)); // ces tables n'existaient pas avant
    const legacy = new DataSource({ ...(await connect(`${service}_legacy`)), entities: legacyEntities, synchronize: true });
    await legacy.initialize();
    await legacy.query(`CREATE TABLE baseline_marker (v int)`);
    await legacy.query(`INSERT INTO baseline_marker VALUES (42)`);
    await legacy.destroy();
    const ds2 = new DataSource({ ...(await connect(`${service}_legacy`)), entities, migrations, migrationsTableName: 'migrations' });
    await ds2.initialize();
    try {
      const before = await businessTables(ds2);
      await runMigrations(ds2);
      const recorded = await ds2.query(`SELECT name FROM migrations`);
      check(service, 'baseline base existante', recorded.length === migrations.length, recorded.map((r) => r.name).join(', '));
      const after = new Set(await businessTables(ds2));
      const marker = (await ds2.query(`SELECT v FROM baseline_marker`))[0]?.v;
      check(service, 'baseline sans perte', before.every((tb) => after.has(tb)) && marker === 42);
    } finally {
      await ds2.destroy();
    }
  }
});

console.log(results.join('\n'));
console.log(failed ? '\nDes tests de migration ont échoué.' : `\nMigrations OK pour ${SERVICES_WITH_DB.length} services.`);
process.exit(failed ? 1 : 0);
