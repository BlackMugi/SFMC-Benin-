// Génère .env depuis .env.example en remplaçant chaque CHANGE_ME par un secret aléatoire.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, '.env');
if (existsSync(target) && !process.argv.includes('--force')) {
  console.log('.env existe déjà (utiliser --force pour le régénérer).');
  process.exit(0);
}
const out = readFileSync(join(root, '.env.example'), 'utf8').replace(/^([A-Z0-9_]+)=CHANGE_ME$/gm, (_, key) => {
  // Mots de passe alphanumériques (compatibles URL AMQP / Postgres)
  const bytes = key === 'JWT_SECRET' ? 48 : 18;
  return `${key}=${randomBytes(bytes).toString('base64url').replace(/[-_]/g, 'x')}`;
});
writeFileSync(target, out);
console.log('.env généré.');
