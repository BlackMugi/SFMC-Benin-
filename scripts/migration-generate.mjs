// Génère une migration TypeORM en comparant les entités du service au schéma produit par ses migrations.
// Usage : npm run migration:generate -- <service> <NomEnPascalCase>
// Le service doit être compilé (npm run build). Un PostgreSQL jetable est lancé dans Docker puis supprimé.
import { writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { withTempPostgres, loadService, SERVICES_WITH_DB } from './lib/migrations.mjs';

const [service, name] = process.argv.slice(2);
if (!SERVICES_WITH_DB.includes(service) || !/^[A-Z][A-Za-z0-9]+$/.test(name ?? '')) {
  console.error(`Usage : npm run migration:generate -- <${SERVICES_WITH_DB.join('|')}> <NomEnPascalCase>`);
  process.exit(1);
}

await withTempPostgres(async (connect) => {
  const { DataSource, entities, migrations } = await loadService(service);
  const ds = new DataSource({ ...(await connect(service)), entities, migrations, migrationsTableName: 'migrations' });
  await ds.initialize();
  try {
    await ds.runMigrations({ transaction: 'each' });
    const { upQueries, downQueries } = await ds.driver.createSchemaBuilder().log();
    if (!upQueries.length) {
      console.log(`${service} : schéma à jour, aucune migration à générer.`);
      return;
    }
    const timestamp = Date.now();
    const className = `${name}${timestamp}`;
    const q = (query) => `    await queryRunner.query(\`${query.query.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\`${query.parameters?.length ? `, ${JSON.stringify(query.parameters)}` : ''});`;
    const file = `import { MigrationInterface, QueryRunner } from 'typeorm';

export class ${className} implements MigrationInterface {
  name = '${className}';

  public async up(queryRunner: QueryRunner): Promise<void> {
${upQueries.map(q).join('\n')}
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
${downQueries.reverse().map(q).join('\n')}
  }
}
`;
    const dir = resolve('services', service, 'src', 'migrations');
    if (!existsSync(dir)) mkdirSync(dir);
    writeFileSync(resolve(dir, `${timestamp}-${name}.ts`), file);
    writeIndex(dir);
    console.log(`${service} : migration ${className} écrite (${upQueries.length} requêtes). Relire le fichier avant de le commiter.`);
  } finally {
    await ds.destroy();
  }
});

/** src/migrations/index.ts : liste ordonnée des migrations, importée par app.module.ts. */
function writeIndex(dir) {
  const files = readdirSync(dir).filter((f) => /^\d{13}-.+\.ts$/.test(f)).sort();
  const entries = files.map((f) => ({ file: f.replace(/\.ts$/, ''), cls: f.replace(/^(\d{13})-(.+)\.ts$/, '$2$1') }));
  writeFileSync(
    resolve(dir, 'index.ts'),
    `// Fichier généré par scripts/migration-generate.mjs : liste ordonnée des migrations du service.\n${entries.map((e) => `import { ${e.cls} } from './${e.file}';`).join('\n')}\n\nexport const MIGRATIONS = [${entries.map((e) => e.cls).join(', ')}];\n`,
  );
}
