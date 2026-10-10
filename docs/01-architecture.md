# Architecture – SFMC Bénin

## Diagramme de composants

```mermaid
flowchart TB
    client([Client / Opérateur / Intégration externe])
    nginx["Reverse proxy nginx<br/>HTTPS (certificat auto-signé en dev)"]
    gw["API Gateway<br/>routage · JWT · rate limiting · CORS"]
    consul[(Consul<br/>service discovery)]
    mq{{RabbitMQ<br/>exchange topic sfmc.events}}

    subgraph services [Microservices NestJS - stateless]
        auth[Auth<br/>JWT · OAuth2]
        user[User<br/>RBAC]
        product[Product<br/>catalogue]
        inventory[Inventory<br/>stocks · seuil critique]
        order[Order<br/>saga]
        production[Production<br/>planification · SSE]
        billing[Billing<br/>factures]
        notification[Notification<br/>email/log]
        reporting[Reporting<br/>vues de lecture]
    end

    subgraph dbs [Database per service - PostgreSQL]
        dbauth[(auth)]
        dbuser[(user)]
        dbproduct[(product)]
        dbinv[(inventory)]
        dborder[(order)]
        dbprod[(production)]
        dbbill[(billing)]
        dbnotif[(notification)]
        dbrep[(reporting)]
    end

    subgraph monitoring [Observabilité]
        prom[Prometheus]
        graf[Grafana]
    end

    client -->|HTTPS| nginx --> gw
    gw -. résolution .-> consul
    gw -->|REST| auth & user & product & inventory & order & production & billing & notification & reporting
    services -. enregistrement + health .-> consul

    auth --- dbauth
    user --- dbuser
    product --- dbproduct
    inventory --- dbinv
    order --- dborder
    production --- dbprod
    billing --- dbbill
    notification --- dbnotif
    reporting --- dbrep

    auth -->|REST: vérif. identifiants| user
    order -->|REST: prix| product
    order -->|REST: disponibilité| inventory
    order -->|REST: jeton client credentials| auth

    order <-->|événements| mq
    inventory <-->|événements| mq
    production <-->|événements| mq
    billing <-->|événements| mq
    notification -->|consomme| mq
    reporting -->|consomme| mq

    prom -->|/metrics| services
    prom -->|/metrics| gw
    graf --> prom
```

### Règles d'architecture

| Règle | Application |
|---|---|
| DDD / bounded contexts | 1 service = 1 domaine (identité, utilisateurs, catalogue, stock, commandes, production, finance, communication, analyse) |
| Database per service | Chaque service a son propre conteneur PostgreSQL ; aucune requête SQL inter-services |
| Sync (REST) | Order → Product (prix), Order → Inventory (disponibilité), Auth → User (identifiants) ; résolus via Consul |
| Async (RabbitMQ) | Tous les changements d'état métier sont publiés en événements ; consommateurs idempotents, ré-essais puis dead-letter |
| Sécurité | JWT vérifié à la Gateway **et** dans chaque service (défense en profondeur) ; RBAC par `@Roles()` |
| Observabilité | `/health`, `/metrics`, logs JSON avec `correlationId` propagé en HTTP (`x-correlation-id`) et dans les événements |

## Catalogue d'événements

| Événement | Publié par | Consommé par |
|---|---|---|
| `OrderCreated` | Order | Inventory, Notification, Reporting |
| `StockReserved` | Inventory | Order, Reporting |
| `StockInsufficient` | Inventory | Order, Notification, Reporting |
| `ProductionRequested` | Order | Production, Reporting |
| `ProductionCompleted` | Production | Inventory, Order, Notification, Reporting |
| `ProductionFailed` | Production | Order, Reporting |
| `StockUpdated` | Inventory | Reporting |
| `StockLow` (seuil critique) | Inventory | Notification, Reporting |
| `OrderValidated` | Order | Billing, Notification, Reporting |
| `InvoiceIssued` | Billing | Order, Notification, Reporting |
| `InvoicePaid` | Billing | Notification, Reporting |
| `OrderShipped` | Order | Inventory (sortie de stock), Notification, Reporting |
| `OrderRejected` / `OrderCancelled` | Order | Inventory (libération), Billing (annulation facture), Notification, Reporting |
| `StockReleased` | Inventory | Reporting |
