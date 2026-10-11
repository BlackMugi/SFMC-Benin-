# Flux commande – Saga par chorégraphie

Aucun orchestrateur central : chaque service réagit aux événements des autres. La cohérence est **éventuelle**.

Dans les diagrammes ci-dessous, « publie » signifie : écrit dans l'outbox du service dans la même transaction que le changement d'état, puis relayé vers RabbitMQ (voir [01-architecture.md](01-architecture.md#publication-fiable-des-événements-outbox)). Une panne du broker ou un crash ne fait donc perdre aucune étape de la saga.

## Cas nominal – stock disponible

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant GW as API Gateway
    participant O as Order
    participant P as Product
    participant I as Inventory
    participant MQ as RabbitMQ
    participant B as Billing
    participant N as Notification
    participant R as Reporting

    C->>GW: POST /api/orders (JWT)
    GW->>GW: vérifie JWT, rate limit, propage identité
    GW->>O: POST /orders
    O->>P: GET /products/:id (REST, jeton de service)
    O->>I: POST /inventory/availability (REST)
    I-->>O: disponible
    O->>O: commande PENDING
    O-->>C: 201 (pending)
    O-)MQ: OrderCreated
    MQ-)I: OrderCreated
    I->>I: réservation atomique (verrou ligne)
    I-)MQ: StockReserved
    MQ-)O: StockReserved
    O->>O: PENDING → VALIDATED
    O-)MQ: OrderValidated
    MQ-)B: OrderValidated
    B->>B: génère la facture
    B-)MQ: InvoiceIssued
    MQ-)N: OrderValidated / InvoiceIssued
    N->>C: email (mock = log)
    MQ-)R: tous les événements → vues de lecture
```

## Cas stock insuffisant – production déclenchée

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant O as Order
    participant I as Inventory
    participant MQ as RabbitMQ
    participant PR as Production
    participant B as Billing
    participant N as Notification
    participant R as Reporting

    C->>O: POST /orders (via Gateway)
    O-->>C: 201 pending
    O-)MQ: OrderCreated
    MQ-)I: OrderCreated
    I->>I: stock < demande → réservation impossible
    I-)MQ: StockInsufficient (manquants)
    MQ-)O: StockInsufficient
    O->>O: phase = awaiting_production
    O-)MQ: ProductionRequested (par produit manquant)
    MQ-)PR: ProductionRequested
    PR->>PR: ordre de fabrication, score = urgence + ancienneté + échéance
    loop planificateur (1 s)
        PR->>PR: affecte à la machine libre compatible, avance la progression
        PR--)C: SSE /api/production/stream (progression temps réel)
    end
    PR-)MQ: ProductionCompleted
    MQ-)I: ProductionCompleted
    I->>I: mouvement IN (stock + production) puis nouvelle tentative de réservation
    I-)MQ: StockUpdated
    I-)MQ: StockReserved
    MQ-)O: StockReserved
    O->>O: PENDING → VALIDATED
    O-)MQ: OrderValidated
    MQ-)B: OrderValidated
    B-)MQ: InvoiceIssued
    MQ-)N: notifications (stock bas / production / validation / facture)
    MQ-)R: vues ventes, stock, production
```

## Compensations (échec)

```mermaid
sequenceDiagram
    autonumber
    participant O as Order
    participant I as Inventory
    participant PR as Production
    participant B as Billing
    participant MQ as RabbitMQ

    Note over PR: aucune machine compatible,<br/>quantité > capacité max
    PR-)MQ: ProductionFailed
    MQ-)O: ProductionFailed
    O->>O: PENDING → REJECTED
    O-)MQ: OrderRejected
    MQ-)I: OrderRejected
    I->>I: libère la réservation (compensation)
    I-)MQ: StockReleased
    MQ-)B: OrderRejected
    B->>B: annule la facture éventuelle

    Note over O: Annulation client après réservation
    O-)MQ: OrderCancelled
    MQ-)I: OrderCancelled
    I->>I: libère la réservation
    Note over O,I: Si StockReserved arrive pour une commande déjà<br/>annulée/rejetée, Order republie OrderCancelled (libération idempotente)
```

## Cycle de vie d'une commande

```mermaid
stateDiagram-v2
    [*] --> pending: création
    pending --> validated: StockReserved
    pending --> rejected: ProductionFailed
    pending --> cancelled: annulation client
    validated --> shipped: expédition (operator/admin)
    validated --> cancelled: annulation
    shipped --> [*]
    rejected --> [*]
    cancelled --> [*]
```

La sous-phase `awaiting_stock` / `awaiting_production` est portée par le champ `phase` d'une commande `pending`.
