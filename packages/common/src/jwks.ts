import { createHash, createPrivateKey, createPublicKey, JsonWebKey, KeyObject } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { env } from './config';

/**
 * Jetons RS256 : seul auth-service détient la clé privée (JWT_PRIVATE_KEY) et signe.
 * Les autres services vérifient avec la clé publique, publiée en JWKS (GET /oauth/jwks).
 */

export interface Jwk extends JsonWebKey {
  kid: string;
  alg: 'RS256';
  use: 'sig';
}

export interface Jwks {
  keys: Jwk[];
}

const ALG = 'RS256';

/** PEM en base64 sur une ligne (variables d'environnement) ou brut. */
function pemFromEnv(value: string): string {
  return value.includes('-----BEGIN') ? value : Buffer.from(value, 'base64').toString('utf8');
}

/** Empreinte RFC 7638 de la clé publique : identifiant stable de la clé (kid). */
export function jwkThumbprint(jwk: JsonWebKey): string {
  const canonical = JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n });
  return createHash('sha256').update(canonical).digest('base64url');
}

function toJwk(publicKey: KeyObject): Jwk {
  const jwk = publicKey.export({ format: 'jwk' });
  if (jwk.kty !== 'RSA') throw new Error('Clé de signature RSA attendue');
  return { kty: jwk.kty, n: jwk.n, e: jwk.e, kid: jwkThumbprint(jwk), alg: ALG, use: 'sig' };
}

interface SigningKey {
  kid: string;
  privateKey: KeyObject;
}

let signingKey: SigningKey | undefined;

/** Clé privée de signature (auth-service uniquement). */
export function hasSigningKey(): boolean {
  return !!process.env.JWT_PRIVATE_KEY;
}

function getSigningKey(): SigningKey {
  if (!signingKey) {
    const privateKey = createPrivateKey(pemFromEnv(env('JWT_PRIVATE_KEY')));
    const jwk = toJwk(createPublicKey(privateKey));
    signingKey = { kid: jwk.kid, privateKey };
  }
  return signingKey;
}

/** Signe un jeton d'accès (RS256, en-tête kid). Réservé à auth-service. */
export function signAccessToken(claims: Record<string, unknown>, ttlSeconds: number): string {
  const { kid, privateKey } = getSigningKey();
  return jwt.sign({ ...claims, typ: 'access' }, privateKey, { algorithm: ALG, keyid: kid, issuer: env('JWT_ISSUER', 'sfmc-auth'), expiresIn: ttlSeconds });
}

/** Clés publiques à publier : la courante, plus l'ancienne pendant une rotation (JWT_PREVIOUS_PUBLIC_KEY). */
export function publicJwks(): Jwks {
  const keys = [toJwk(createPublicKey(getSigningKey().privateKey))];
  const previous = process.env.JWT_PREVIOUS_PUBLIC_KEY;
  if (previous) keys.push(toJwk(createPublicKey(pemFromEnv(previous))));
  return { keys };
}

/**
 * Cache des clés publiques. Une clé inconnue (rotation) recharge le JWKS, au plus une fois toutes les 5 s
 * et une requête à la fois, pour qu'un kid inventé ne puisse pas saturer auth-service.
 */
class KeyStore {
  private keys = new Map<string, KeyObject>();
  private lastFetch = 0;
  private inflight?: Promise<void>;
  private resolver?: () => Promise<Jwks>;

  /** Source du JWKS : locale pour auth-service, HTTP via Consul pour les autres. */
  setResolver(resolver: () => Promise<Jwks>) {
    this.resolver = resolver;
  }

  async get(kid: string): Promise<KeyObject | undefined> {
    const known = this.keys.get(kid);
    if (known && Date.now() - this.lastFetch < 600_000) return known; // rechargé au moins toutes les 10 min
    if (!known && Date.now() - this.lastFetch < 5_000) return undefined;
    await this.refresh().catch((e) => {
      if (!known) throw e;
    });
    return this.keys.get(kid) ?? known;
  }

  private refresh(): Promise<void> {
    this.inflight ??= (async () => {
      try {
        const resolver = this.resolver ?? (hasSigningKey() ? async () => publicJwks() : undefined);
        if (!resolver) throw new Error('Source des clés publiques (JWKS) non configurée');
        const jwks = await resolver();
        const next = new Map<string, KeyObject>();
        for (const k of jwks.keys ?? []) {
          if (k.kty === 'RSA' && k.kid && (!k.alg || k.alg === ALG)) next.set(k.kid, createPublicKey({ key: k, format: 'jwk' }));
        }
        if (!next.size) throw new Error('JWKS vide');
        this.keys = next;
        this.lastFetch = Date.now();
      } finally {
        this.inflight = undefined;
      }
    })();
    return this.inflight;
  }

  /** Pour les tests : oublie les clés chargées. */
  reset() {
    this.keys.clear();
    this.lastFetch = 0;
  }
}

export const keyStore = new KeyStore();

/** La clé publique n'a pas pu être obtenue (auth-service injoignable). Ce n'est pas un jeton invalide. */
export class KeysUnavailableError extends Error {}

/** Vérifie signature (RS256 uniquement), émetteur et expiration. */
export async function verifyJwt(token: string): Promise<jwt.JwtPayload> {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded.payload === 'string') throw new Error('jeton illisible');
  if (decoded.header.alg !== ALG || !decoded.header.kid) throw new Error('algorithme ou kid refusé');
  let key: KeyObject | undefined;
  try {
    key = await keyStore.get(decoded.header.kid);
  } catch (e) {
    throw new KeysUnavailableError((e as Error).message);
  }
  if (!key) throw new Error('clé de signature inconnue');
  return jwt.verify(token, key, { algorithms: [ALG], issuer: env('JWT_ISSUER', 'sfmc-auth') }) as jwt.JwtPayload;
}
