// Génère .env depuis .env.example en remplaçant chaque CHANGE_ME par un secret aléatoire
// (CHANGE_ME_RSA : clé privée RSA 2048 en PEM, base64 sur une ligne).
// Si .env existe, seules les variables absentes sont ajoutées. --force régénère tout.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, '.env');
const example = readFileSync(join(root, '.env.example'), 'utf8');

function secretFor(key, placeholder) {
  if (placeholder === 'CHANGE_ME_RSA') {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    return Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
  }
  // Alphanumériques, compatibles avec les URL AMQP et Postgres
  return randomBytes(18).toString('base64url').replace(/[-_]/g, 'x');
}

const fill = (text) => text.replace(/^([A-Z0-9_]+)=(CHANGE_ME(?:_RSA)?)$/gm, (_, key, placeholder) => `${key}=${secretFor(key, placeholder)}`);

if (!existsSync(target) || process.argv.includes('--force')) {
  writeFileSync(target, fill(example));
  console.log('.env généré.');
  process.exit(0);
}

const current = readFileSync(target, 'utf8');
const present = new Set([...current.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));
const missing = example.split(/\r?\n/).filter((line) => {
  const m = /^([A-Z0-9_]+)=/.exec(line);
  return m && !present.has(m[1]);
});
if (!missing.length) {
  console.log('.env déjà complet.');
  process.exit(0);
}
writeFileSync(target, `${current.replace(/\s*$/, '\n')}\n# Ajouté par npm run init:env\n${fill(missing.join('\n'))}\n`);
console.log(`.env complété : ${missing.map((l) => l.split('=')[0]).join(', ')}`);
