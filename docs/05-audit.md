# Audit d'ingénierie

Audit réalisé sur le dépôt et sur la plateforme en fonctionnement. Chaque point a été vérifié par une commande, pas seulement par lecture du code.

## 1. Reproductibilité (clone propre, démarrage à froid)

Procédure : `git clone`, `npm install`, `npm run init:env`, `docker compose up --build -d`, puis `npm run demo` et `npm run test:integration`.

| Constat | Gravité | Correction |
|---|---|---|
| `docker compose up` échouait au premier démarrage (« rabbitmq is unhealthy ») : le healthcheck `rabbitmq-diagnostics`, lancé en root avant que le broker ait créé son `.erlang.cookie`, le créait avec de mauvais droits (`eacces`) et faisait planter le broker | Haute (le critère de fin du cahier n'était pas reproductible) | Healthcheck par test de port (`nc -z 127.0.0.1 5672`). Vérifié : 2 démarrages à froid consécutifs, 0 redémarrage du broker |
| Les images ne contenaient pas `dist/main.js` (fichier `tsbuildinfo` copié dans le contexte de build) | Haute | `**/*.tsbuildinfo` ajouté à `.dockerignore` |
| Le test d'intégration ne pouvait pas tourner sous Jest (certificat auto-signé refusé par `fetch`) | Moyenne | `globalSetup` dédié |

Résultat final sur clone propre : démarrage OK, démo 12 étapes OK, 7 tests d'intégration sur 7.

## 2. Sécurité

Contrôles exécutés contre la plateforme réelle (HTTPS, port 8443) : 16 sur 16 réussis.

- En-têtes : HSTS, `X-Content-Type-Options`, `X-Frame-Options`, CSP présents ; pas de `X-Powered-By`.
- JWT : `alg=none` et signature falsifiée rejetés (401) ; refresh token rejoué refusé (détection de rejeu).
- Injection : SQLi sur paramètre et sur login sans erreur 500 (requêtes paramétrées) ; réponses uniquement JSON.
- Validation : DTO invalides refusés (400) ; élévation de privilège par `role=admin` à l'inscription refusée ; corps > 1 Mo refusé (413).
- Autorisation : en-têtes `x-user-*` fournis par le client ignorés ; endpoints `/internal/*` bloqués à la gateway ; CORS fermé aux origines inconnues.
- Autorisation par objet (revue du code) : un client ne lit que ses commandes, factures et son profil (`customerId` vérifié dans Order, Billing, User).
- Exposition réseau : seuls les ports 8080/8443 (nginx) sont publiés sur toutes les interfaces ; tous les autres sont liés à `127.0.0.1`.
- Secrets : aucun secret versionné (`.env` ignoré), secrets aléatoires générés par `npm run init:env`.

### Dépendances (`npm audit --omit=dev`)

| Paquet | Statut |
|---|---|
| `js-yaml` (via `@nestjs/swagger`) | Corrigé : version 5.4.3 forcée par `overrides` |
| `braces` / `micromatch` / `http-proxy-middleware` (3 alertes « high », déni de service par motifs glob imbriqués) | **Risque accepté** : aucun correctif publié en amont (`braces` 3.0.3 est la dernière version), la « solution » proposée par npm est une rétrogradation vers 0.2.0. Non exploitable ici : les motifs glob sont écrits dans notre code, jamais fournis par un client. À réévaluer à chaque mise à jour |

## 3. Qualité du code

- Compilation TypeScript en mode `strict` : 0 erreur.
- Tests unitaires : 59 tests, 11 suites ; intégration : 7 tests ; charge : voir README.
- ESLint ajouté (`npm run lint`) : 0 erreur, 17 avertissements (usage de `any` ciblé, surtout aux frontières RabbitMQ et JSON).
- Défaut trouvé par le linter : dans Order, l'échec de publication de `OrderCreated` était avalé sans trace. Il est maintenant journalisé (la compensation, commande rejetée, existait déjà).

## 4. Améliorations « production » (suite de l'audit)

### Migrations versionnées (objectif 1)
- 9 bases (la gateway n'en a pas) : migration initiale générée depuis les entités, puis relue ; extension `uuid-ossp` et séquence des factures rendues explicites.
- Application automatique au démarrage sous `pg_advisory_lock` ; reprise des bases existantes par *baseline* ; `synchronize` désactivé.
- Preuve : `npm run test:migrations` : 63 contrôles sur 63 (up, schéma = entités, down complet, up à nouveau, baseline sans perte). Sur la plateforme existante : 9 baselines, 13 commandes avant et après.
- Défaut trouvé au passage : la compilation incrémentale de TypeScript (cache `tsbuildinfo` hors de `dist/`, que `nest build` vide) produisait des `dist/` incomplets en local. Compilation incrémentale désactivée.

### Outbox transactionnelle (objectif 2)
- Toutes les publications (Order, Inventory, Billing, Production : 17 points de publication) passent par `Outbox.run()` : état métier et événements dans la même transaction. La publication directe a été retirée du bus.
- Relais par instance (`FOR UPDATE SKIP LOCKED`, ordre conservé, échec immédiat si le broker est absent pour ne pas tenir de verrous), purge après 7 jours.
- Consommateurs : déduplication par identifiant d'événement (`processed_events`) en plus de l'idempotence métier existante.
- `/health` : le broker n'est plus bloquant (`degraded` au lieu de 503), nombre d'événements en attente exposé (`outboxPending`).
- Preuve : `npm run test:resilience` (2/2) : broker arrêté + crash de `order-service` → commande validée et facturée après redémarrage, aucune ligne restée en attente ; doublon renvoyé à la main → ignoré, aucune réservation en plus.
- Limite : un consommateur qui plante **après** son traitement mais **avant** d'enregistrer l'identifiant retraitera l'événement ; c'est sans effet car chaque traitement est lui-même idempotent (compare-and-set, clés d'unicité), mais ce n'est pas une garantie « exactement une fois » au sens strict.

### Jetons RS256 + JWKS (objectif 3)
- Avant : un secret partagé (HS256) par les 10 services servait à signer **et** à vérifier ; un seul service compromis permettait de fabriquer des jetons administrateur.
- Après : clé privée RSA 2048 chez `auth-service` uniquement ; publication JWKS (`kid` = empreinte RFC 7638) ; vérification par clé publique partout, avec cache et rechargement limité (une fois toutes les 5 s au plus en cas de `kid` inconnu, une seule requête à la fois ; rechargement complet toutes les 10 min) ; rotation par clé précédente ; `JWT_SECRET` supprimé. Aucune nouvelle dépendance (crypto native de Node).
- Si `auth-service` est injoignable au moment où un service doit charger les clés : réponse 503 (et non 401), pour ne pas déconnecter les utilisateurs à tort.
- Preuves : tests unitaires (jeton valide, clé précédente acceptée, autre clé, `alg=none`, confusion HS256/clé publique, `kid` inventé, type `refresh`, aucune partie privée dans le JWKS) ; sur la plateforme : clé privée présente dans le seul conteneur `auth-service`, `JWT_SECRET` absent partout, attaque par confusion d'algorithme refusée à la gateway et directement sur un service (401), jetons émis en RS256 avec un `kid` publié.

### Tests de sécurité permanents (objectif 4)
- `npm run test:security` : 24 tests contre la plateforme réelle (HTTPS via la gateway et appels directs aux services). Transport (redirection HTTPS, en-têtes) ; JWT (absent, `alg=none`, confusion HS256/clé publique, autre clé RSA, `kid` inventé, contenu altéré, rejeu de refresh token avec révocation de la famille, message identique pour compte inconnu ou mauvais mot de passe) ; autorisation (RBAC, en-têtes `x-user-*` forgés via la gateway et en direct, accès à la commande et à la facture d'un autre client, modification du profil d'un autre, auto-promotion admin, endpoints internes, scopes OAuth2 partenaire) ; entrées (SQLi en paramètre, en identifiant et au login, XSS, mass assignment, DTO stricts, corps > 1 Mo) ; CORS ; limitation des tentatives de connexion.
- Défaut trouvé : le nettoyage XSS laissait le texte contenu dans une balise `<script>` (`alert(1)`, inoffensif mais inutile). Le contenu des balises `script` et `style` est désormais retiré en entier.

## 5. Limites assumées (hors périmètre de la démonstration)

- Consul en mode `-dev`, RabbitMQ et PostgreSQL en instance unique : pas de haute disponibilité de l'infrastructure elle-même.
- Rate limit compté par instance de gateway.
