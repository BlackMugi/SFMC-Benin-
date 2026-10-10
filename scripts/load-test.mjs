// Lance k6 (image Docker) dans le réseau du compose : charge sur la gateway, seuils p95 < 2 s et erreurs < 1 %.
// Usage : node scripts/load-test.mjs [--kill <service>]   (--kill : arrête une réplique en cours de test, vérifie la continuité)
import { spawn, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(readFileSync(resolve(root, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const killIdx = process.argv.indexOf('--kill');
const kill = killIdx > 0 ? process.argv[killIdx + 1] : null;

const args = ['run', '--rm', '--network', 'sfmc_sfmc', '-v', `${resolve(root, 'tests/load')}:/scripts:ro`,
  '-e', `ADMIN_EMAIL=${env.ADMIN_EMAIL}`, '-e', `ADMIN_PASSWORD=${env.ADMIN_PASSWORD}`, '-e', 'DURATION=' + (kill ? '60s' : '40s'),
  'grafana/k6:0.54.0', 'run', '/scripts/k6-load.js'];
const k6 = spawn('docker', args, { stdio: 'inherit' });

if (kill) {
  setTimeout(() => {
    const victim = execSync(`docker compose ps -q ${kill}`, { cwd: root }).toString().split(/\r?\n/).filter(Boolean)[0];
    console.log(`\n>>> Arrêt brutal d'une réplique de ${kill} (${victim.slice(0, 12)}) pendant la charge\n`);
    execSync(`docker kill ${victim}`); // un kill manuel n'est pas relancé par la politique de redémarrage
    setTimeout(() => execSync(`docker start ${victim}`), 25_000);
  }, 20_000);
}
k6.on('exit', (code) => process.exit(code ?? 1));
