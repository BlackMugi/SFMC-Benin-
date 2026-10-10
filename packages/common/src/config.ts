/** Lit une variable d'environnement. Pas de secret par défaut : une variable requise absente fait échouer le démarrage. */
export function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Variable d'environnement requise manquante : ${name}`);
}

export function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function envFloat(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}
