# Déploiement, planning et risques

Complète les chapitres 7 (planning), 8 (risques) et 9 (facteurs clés de réussite) du cahier des charges.

## 1. Déploiement en production

### Prérequis
- Serveur Linux (4 vCPU, 8 Go de RAM minimum pour la configuration à 2 répliques), Docker Engine ≥ 24 avec Compose v2.24+.
- Nom de domaine pointant vers le serveur, ports 80 et 443 ouverts (rien d'autre : les ports techniques sont liés à `127.0.0.1`).
- Certificat TLS (Let's Encrypt, par exemple `certbot certonly --standalone -d api.exemple.bj`).

### Étapes
```bash
git clone <dépôt> sfmc && cd sfmc
npm install && npm run init:env          # génère .env avec des secrets aléatoires
```
Éditer `.env` :

| Variable | Valeur en production |
|---|---|
| `CORS_ORIGINS` | domaine(s) réel(s) du front, sans wildcard |
| `SEED_DEMO_DATA` | `false` (pas de données de démonstration) |
| `ADMIN_PASSWORD`, `GRAFANA_ADMIN_PASSWORD` | mots de passe forts, à changer après la première connexion |
| `QUALITY_FAIL_RATE` | `0` tant qu'aucun contrôle réel n'est branché |
| `GATEWAY_RATE_LIMIT` | à ajuster selon le trafic (300 req/min/IP par défaut) |

Certificat : copier `fullchain.pem` en `certs/tls.crt` et `privkey.pem` en `certs/tls.key`.

Démarrage (2 répliques, certificat réel, ports 80/443) :
```bash
docker compose -f docker-compose.yml -f docker-compose.scale.yml -f docker-compose.prod.yml up -d --build
docker compose ps                         # tous les services doivent être « healthy »
curl https://api.exemple.bj/api/products -H "authorization: Bearer <jeton>"
```

### Clé de signature des jetons

- `JWT_PRIVATE_KEY` (générée par `npm run init:env`) n'est transmise qu'à `auth-service`. C'est le secret le plus sensible : la sauvegarder hors du serveur, ne jamais la copier ailleurs.
- `npm run init:env` sur un `.env` existant ajoute seulement les variables manquantes, sans modifier les mots de passe des bases.
- **Rotation** (par précaution, ou si la clé a fuité) :
  1. extraire la clé publique actuelle : `node -e "const c=require('crypto');const k=c.createPublicKey(Buffer.from(process.env.K,'base64').toString());console.log(Buffer.from(k.export({type:'spki',format:'pem'})).toString('base64'))"` avec `K` = valeur actuelle de `JWT_PRIVATE_KEY` ;
  2. la placer dans `JWT_PREVIOUS_PUBLIC_KEY`, puis générer une nouvelle `JWT_PRIVATE_KEY` : **supprimer la ligne** `JWT_PRIVATE_KEY=...` du `.env` et relancer `npm run init:env` (qui ne recrée que les variables absentes) ;
  3. `docker compose up -d auth-service` : les nouveaux jetons sont signés avec la nouvelle clé, les anciens restent acceptés ;
  4. après `JWT_ACCESS_TTL` (15 min par défaut), vider `JWT_PREVIOUS_PUBLIC_KEY` et redémarrer `auth-service`. **En cas de fuite** : à l'étape 2, ne pas renseigner `JWT_PREVIOUS_PUBLIC_KEY` ; puis `docker compose restart` pour vider les caches de clés publiques des services (sinon l'ancienne clé reste acceptée jusqu'à 10 minutes) ; tous les utilisateurs devront se reconnecter.

### Exploitation
- **Mise à jour sans interruption** : `docker compose ... up -d --build <service>` recrée une réplique après l'autre pour les services à 2 répliques ; Consul retire l'instance qui s'arrête.
- **Sauvegarde** : `docker compose exec <service>-db pg_dump -U <user> <base> > sauvegarde.sql` (une base par service), à planifier chaque nuit (cron) et à copier hors du serveur. Volumes à conserver : `*-db-data`, `grafana-data`.
- **Supervision** : Grafana (tableau « SFMC – Vue d'ensemble »), Prometheus, `/health` de chaque service. Exposer Grafana uniquement via un tunnel SSH ou un reverse proxy authentifié.
- **Rollback** : `git checkout <tag précédent>` puis même commande `up -d --build`.
- **Montée de version du schéma** : automatique au démarrage de chaque service (migrations versionnées, verrou PostgreSQL). Faire une sauvegarde `pg_dump` avant toute mise à jour qui contient une nouvelle migration ; en cas de problème, restaurer la sauvegarde et redéployer la version précédente.

## 2. Planning (réalisé)

| Phase | Activités | Livrables |
|---|---|---|
| Analyse | lecture du cahier, choix techniques | stack NestJS, PostgreSQL, RabbitMQ, Consul |
| Conception | UML et architecture | `docs/01` à `03` (composants, séquences, données) |
| Développement | 10 microservices en 6 phases commitées | code, Docker Compose, Swagger |
| Tests | unitaires par service, e2e du flux commande, charge k6 | `npm test`, `tests/integration`, `npm run load` |
| Déploiement | scénario de démo, surcharges scale et prod | `npm run demo`, ce document |

## 3. Risques techniques et parades

| Risque (cahier §8) | Parade mise en œuvre | Reste à faire |
|---|---|---|
| Complexité de la communication inter-services | Contrats d'événements typés dans `packages/common`, catalogue d'événements documenté, `correlation-id` propagé et chronologie par commande (Reporting) | Aucun |
| Transactions distribuées | Saga par chorégraphie avec compensations (réservation annulée, commande rejetée), opérations idempotentes (rejeu d'événement sans doublon), transitions d'état en compare-and-set | Aucun (outbox en place) |
| Latence réseau | Appel REST synchrone limité à Order → Inventory, timeouts courts, instance morte écartée et lectures rejouées par la gateway, mesure k6 : p95 ≈ 80 ms | Cache de lecture du catalogue |
| Synchronisation des données | Cohérence éventuelle assumée, base par service, vues de lecture Reporting alimentées par événements, réservations atomiques côté Inventory | Réconciliation périodique Inventory / Reporting |

## 4. Facteurs clés de réussite

| Facteur | Où le vérifier |
|---|---|
| Bonne définition des domaines (DDD) | un service par domaine, une base par service, aucun accès croisé (`docs/01-architecture.md`) |
| Tests automatisés | `npm test` (suites unitaires par service), `npm run test:integration`, `npm run load` |
| Monitoring efficace | `/health` et `/metrics` partout, Prometheus et Grafana, logs JSON avec `correlation-id` |
| Sécurité robuste | HTTPS, JWT vérifié à la gateway, RBAC, validation des DTO, rate limiting, secrets hors du code |
