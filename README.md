# SFMC Bénin – Plateforme microservices

Production et distribution de matériaux de construction (ciment, fer, briques, granulats).
Architecture microservices **NestJS + TypeScript**, **PostgreSQL** (une base par service), **RabbitMQ**, **Consul**, **Docker Compose**, **Prometheus + Grafana**.

## Démarrage rapide

Prérequis : Docker (avec Compose v2) et Node.js ≥ 20 (uniquement pour le script de démo et les tests).

```bash
npm install                # dépendances du monorepo (npm workspaces)
npm run init:env           # génère .env avec des secrets aléatoires (depuis .env.example)
docker compose up --build -d
npm run demo               # ou ./demo.sh : rejoue le scénario complet
```

Le premier démarrage construit 10 images (quelques minutes). Les services attendent leur base, RabbitMQ et Consul (`depends_on` + retries).

| Accès | URL |
|---|---|
| API (HTTPS, certificat auto-signé) | `https://localhost:8443/api/...` (HTTP 8080 → redirigé) |
| Swagger de chaque service | `http://localhost:300x/docs` (3000 gateway, 3001 auth, 3002 user, 3003 product, 3004 inventory, 3005 order, 3006 production, 3007 billing, 3008 notification, 3009 reporting) |
| Grafana (dashboard « SFMC – Vue d'ensemble ») | http://localhost:3100 (`GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` du `.env`) |
| Prometheus | http://localhost:9090 |
| RabbitMQ management | http://localhost:15672 (`RABBITMQ_USER` / `RABBITMQ_PASSWORD`) |
| Consul UI | http://localhost:8500 |

Les ports techniques sont liés à `127.0.0.1` : seul le reverse proxy HTTPS est exposé. Compte admin : `ADMIN_EMAIL` / `ADMIN_PASSWORD` du `.env`.

## Architecture

```
Client ──HTTPS──▶ nginx ──▶ API Gateway ──(Consul)──▶ auth · user · product · inventory
                            JWT, rate limit, CORS      order · production · billing
                                                        notification · reporting
                   chaque service ──▶ sa base PostgreSQL     ◀──▶ RabbitMQ (événements)
```

Diagrammes Mermaid détaillés dans [`docs/`](docs/) :
- [`01-architecture.md`](docs/01-architecture.md) : diagramme de composants, règles, catalogue d'événements ;
- [`02-sequences-commande.md`](docs/02-sequences-commande.md) : flux commande (cas nominal, stock insuffisant, compensations, états) ;
- [`03-donnees.md`](docs/03-donnees.md) : schémas de données par service.

| Service | Rôle |
|---|---|
| `api-gateway` | Point d'entrée unique `/api/<ressource>` : résolution Consul, JWT centralisé, rate limiting, CORS, propagation d'identité (`x-user-*`) et du `x-correlation-id` |
| `auth` | Login JWT (access + refresh avec rotation et détection de rejeu), OAuth2 *client credentials* (inter-services et intégrations externes), introspection RFC 7662 |
| `user` | CRUD utilisateurs, rôles `admin` / `operator` / `client`, inscription publique (client uniquement) |
| `product` | Catalogue (ciment, fer, briques, granulats) |
| `inventory` | Multi-entrepôts, `Stock` / `StockMovement` (IN/OUT), transferts, réservations atomiques, **seuil critique dynamique** + alerte |
| `order` | Cycle `pending → validated → shipped` (+ `rejected`, `cancelled`) et saga |
| `production` | Machines, ordres de fabrication, planification par priorité, suivi temps réel **SSE** |
| `billing` | Facture (TVA) à la validation, paiement (fournisseur interchangeable) |
| `notification` | Consomme les événements ; interface `NotificationProvider` (mock, webhook) |
| `reporting` | Vues de lecture : ventes, stocks, production, chronologie des commandes |

### Saga de commande (chorégraphie)

`OrderCreated` → Inventory réserve (tout ou rien) → `StockReserved` → `OrderValidated` → `InvoiceIssued`.
Si le stock manque : `StockInsufficient` → Order publie `ProductionRequested` → Production planifie, fabrique (progression SSE) → `ProductionCompleted` → Inventory crée le mouvement IN (`StockUpdated`), relance la réservation → `StockReserved` → commande validée.

**Compensations** : `ProductionFailed` → commande `rejected` → `OrderRejected` → Inventory libère la réservation (`StockReleased`), Billing annule la facture ; annulation client → `OrderCancelled` (mêmes effets) ; si `StockReserved` arrive après une annulation, Order republie `OrderCancelled` (libération idempotente).

Garanties : consommateurs idempotents (clés d'unicité, compare-and-set), 3 ré-essais puis file `sfmc.dead-letters`, verrous `FOR UPDATE` ordonnés (pas d'interblocage), cohérence éventuelle.

### Seuil critique (Inventory)

`seuil = max(minThreshold, ⌈sortie moyenne/jour sur 7 j × LEAD_TIME_DAYS⌉)`. Quand `quantité − réservé ≤ seuil`, un événement `StockLow` est émis (une fois par franchissement, ré-armé quand le stock remonte) → notification à `ADMIN_NOTIFY_EMAIL`.

### Planification (Production)

Priorité = `urgence × 100` + ancienneté (0,5/min, plafonné) + échéance (+50 sous 24 h, +100 dépassée). Chaque machine libre prend l'ordre le plus prioritaire de sa catégorie ; `GET /api/production/planning` donne l'ordre de passage et les créneaux estimés. `PRODUCTION_SPEED_FACTOR` accélère la simulation.

### Contrôle qualité (Production)

Fin de fabrication : la machine est libérée et le lot passe à `QUALITY_CHECK` (`QUALITY_CHECK_SECONDS`, 2 s par défaut). Lot conforme : `COMPLETED` puis `ProductionCompleted` (mise en stock). Lot non conforme (taux `QUALITY_FAIL_RATE`, 0 par défaut) : `FAILED` puis `ProductionFailed`, la commande est rejetée (compensation). Le résultat (`qualityResult`, `qualityNotes`) est stocké sur l'ordre de fabrication et visible dans le flux SSE (`quality_check`).

## Disponibilité et performance

- Services stateless, `restart: unless-stopped`, healthchecks Docker, retrait automatique des instances malsaines par Consul.
- **Haute disponibilité** : `docker compose -f docker-compose.yml -f docker-compose.scale.yml up -d --build` lance 2 répliques de gateway, auth, product, inventory et order. nginx répartit la charge entre les gateways (DNS dynamique), les gateways entre les services (Consul, round-robin), Prometheus scrape chaque réplique. `production-service` reste unique (flux SSE en mémoire). Le rate limit est compté par instance de gateway.
- La gateway écarte une instance injoignable et rejoue les requêtes de lecture (GET/HEAD) sur une autre.
- **Test de charge k6** (`npm run load`) : 30 utilisateurs virtuels sur 6 endpoints, seuils p95 < 2 s et erreurs < 1 %. `npm run load:ha` tue en plus une réplique d'`order-service` pendant la charge. Pour la charge, relever `GATEWAY_RATE_LIMIT` (par ex. 100000) avant `docker compose up`.
- Mesuré en local (stack à 2 répliques) : p95 ≈ 80 ms, 0 % d'erreur, ≈ 400 req/s. Avec arrêt brutal d'une réplique : < 1 % d'erreurs (requêtes en vol sur l'instance tuée).

## Sécurité (OWASP)

- **HTTPS** via nginx (certificat auto-signé généré au démarrage, TLS 1.2+, HSTS) ; en production, monter un vrai certificat dans le volume `nginx-certs`.
- **JWT HS256** : émis par Auth, vérifié à la Gateway **et** dans chaque service (défense en profondeur) ; RBAC par `@Roles()` ; les en-têtes `x-user-*` du client sont supprimés puis réécrits par la Gateway.
- Endpoints `internal`, `/metrics`, `/health` non routés par la Gateway ; réservés au rôle `service` (jeton *client credentials*).
- **Validation stricte** : `ValidationPipe` (`whitelist` + `forbidNonWhitelisted`), DTO typés, UUID validés, bornes numériques ; texte libre assaini (balises HTML retirées).
- **Injection SQL** : uniquement requêtes paramétrées (TypeORM). **XSS** : `helmet` (CSP, nosniff…) + assainissement. **CSRF** : API sans cookie, jeton Bearer dans l'en-tête (pas de session ambiante à forger). **CORS** : origines explicites (`CORS_ORIGINS`).
- **Rate limiting** : global (`GATEWAY_RATE_LIMIT`) et renforcé sur login/refresh/token/register (`GATEWAY_AUTH_RATE_LIMIT`).
- Mots de passe `bcrypt` ; refresh tokens stockés hachés (SHA-256) avec rotation ; secrets clients hachés ; comparaison à temps constant.
- **Aucun secret en dur** : tout vient du `.env` (ignoré par git) ; `.env.example` fourni.

## Observabilité

- Chaque service : `GET /health` (base, broker, Consul) et `GET /metrics` (Prometheus : latence HTTP par route, événements publiés/consommés/en échec, métriques Node).
- Logs JSON structurés avec `correlationId` : repris/généré à l'entrée (`x-correlation-id`), propagé dans les appels REST inter-services et dans les enveloppes d'événements, restauré chez les consommateurs.
- Dashboard Grafana provisionné : services UP, requêtes/s, latence p95 (seuil 2 s), erreurs 4xx/5xx, événements publiés/consommés, échecs dead-letter, mémoire, event-loop.

## Variables d'environnement

Voir [`.env.example`](.env.example). Principales :

| Variable | Rôle |
|---|---|
| `JWT_SECRET`, `JWT_ISSUER`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL_DAYS` | Jetons |
| `RABBITMQ_USER/PASSWORD` | Broker |
| `<SERVICE>_DB_PASSWORD` | Mot de passe de la base de chaque service |
| `ORDER_CLIENT_SECRET`, `PARTNER_DEMO_CLIENT_SECRET` | Secrets OAuth2 client credentials (Order → autres services ; partenaire de démo) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Administrateur initial |
| `CORS_ORIGINS`, `GATEWAY_RATE_LIMIT`, `GATEWAY_AUTH_RATE_LIMIT` | Gateway |
| `SEED_DEMO_DATA`, `DEFAULT_WAREHOUSE_CODE`, `LEAD_TIME_DAYS` | Données de démo, entrepôt de réception, délai de réappro |
| `PRODUCTION_SPEED_FACTOR`, `MAX_WORK_ORDER_QTY` | Simulation de production, capacité max d'un ordre |
| `TAX_RATE`, `CURRENCY` | Facturation |
| `NOTIFICATION_PROVIDER` (`mock`\|`webhook`), `NOTIFICATION_WEBHOOK_URL`, `ADMIN_NOTIFY_EMAIL` | Notifications |
| `GRAFANA_ADMIN_USER/PASSWORD`, `HTTPS_PORT`, `HTTP_PORT` | Monitoring et ports |

## Commandes

| Commande | Effet |
|---|---|
| `npm install` | Installe tout le monorepo |
| `npm run build` | Compile `@sfmc/common` puis tous les services |
| `npm test` | Tests unitaires de chaque service |
| `docker compose up --build -d` / `npm run up` | Démarre la plateforme |
| `npm run demo` / `./demo.sh` | Rejoue le scénario de bout en bout |
| `npm run test:integration` | Test d'intégration du flux commande (plateforme démarrée) |
| `docker compose logs -f order-service` | Logs JSON d'un service |
| `docker compose up -d --scale inventory-service=2` | Scalabilité horizontale (services stateless, consommateurs concurrents) |
| `docker compose down -v` | Arrêt et suppression des données |

## Scénario de démo

`npm run demo` exécute, avec sortie commentée :

1. inscription + authentification du client (JWT) ;
2. commande de 80 sacs de plus que le stock → statut `pending` ;
3. saga : `StockInsufficient` → `ProductionRequested` → production suivie en temps réel (barre de progression SSE) → `ProductionCompleted` ;
4. stock mis à jour (mouvement IN), réservé, alerte de seuil critique ;
5. commande `validated` → facture émise → paiement ;
6. notifications envoyées (client et équipe) ;
7. Reporting : chronologie des événements, ventes, production, stock ;
8. expédition (sortie de stock) ;
9. compensation : commande impossible à produire → `rejected`, stock inchangé, pas de facture ;
10. intégration externe OAuth2 *client credentials* ; contrôles 401/403.

Manuellement (curl, `-k` pour le certificat auto-signé) :

```bash
TOKEN=$(curl -sk https://localhost:8443/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@sfmc.bj","password":"<ADMIN_PASSWORD>"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
curl -sk https://localhost:8443/api/products -H "authorization: Bearer $TOKEN"
curl -skN https://localhost:8443/api/production/stream -H "authorization: Bearer $TOKEN"   # SSE
```

## Déploiement en production

Procédure complète (certificat TLS, variables, sauvegardes, rollback), planning, risques techniques et facteurs de réussite : [`docs/04-deploiement-risques.md`](docs/04-deploiement-risques.md). Commande : `docker compose -f docker-compose.yml -f docker-compose.scale.yml -f docker-compose.prod.yml up -d --build`.

## Structure

```
packages/common     lib partagée : logger JSON, correlation-id, JWT/RBAC, Consul, RabbitMQ, client REST, métriques, bootstrap
services/<nom>      un microservice NestJS indépendant (code, entités, tests, Dockerfile commun docker/service.Dockerfile)
infra/              nginx (HTTPS), prometheus, grafana (provisioning + dashboard)
docs/               diagrammes Mermaid
tests/integration   test e2e du flux commande + helpers partagés avec le script de démo
scripts/            init-env.mjs, demo.mjs
```

## Limites connues / pistes

- `synchronize: true` (TypeORM) pour la démo : prévoir des migrations en production.
- JWT HS256 à secret partagé : passer à RS256 + JWKS pour isoler la clé de signature.
- Publication d'événements après commit sans *outbox* : un crash entre les deux pourrait perdre un événement (atténué à la création de commande par rejet compensatoire).
- Consul en mode `-dev` (un seul nœud, non persistant) ; RabbitMQ et PostgreSQL en instance unique.
