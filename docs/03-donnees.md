# Schémas de données par service

Le schéma de chaque base est défini par les entités TypeORM et créé par les migrations versionnées du service (`services/<service>/src/migrations`, table de suivi `migrations`). Billing possède en plus la séquence `invoice_number_seq` (numérotation des factures).

Chaque service possède sa base PostgreSQL. Les références entre services (`product_id`, `customer_id`, `order_id`) sont de simples identifiants, sans clé étrangère entre bases.

## Auth

```mermaid
erDiagram
    REFRESH_TOKEN {
        uuid id PK
        uuid user_id
        string token_hash UK
        uuid family_id
        timestamp expires_at
        timestamp revoked_at
        timestamp created_at
    }
    OAUTH_CLIENT {
        uuid id PK
        string client_id UK
        string secret_hash
        string name
        string role "service | partner"
        string[] scopes
        boolean active
    }
```

## User

```mermaid
erDiagram
    USER {
        uuid id PK
        string email UK
        string password_hash
        string first_name
        string last_name
        string role "admin | operator | client"
        boolean active
        timestamp created_at
    }
```

## Product

```mermaid
erDiagram
    PRODUCT {
        uuid id PK
        string sku UK
        string name
        string category "cement | iron | brick | aggregate"
        string unit
        numeric unit_price
        string description
        boolean active
    }
```

## Inventory

```mermaid
erDiagram
    WAREHOUSE ||--o{ STOCK : contient
    STOCK ||--o{ STOCK_MOVEMENT : historise
    WAREHOUSE {
        uuid id PK
        string code UK
        string name
        string location
    }
    STOCK {
        uuid id PK
        uuid product_id
        uuid warehouse_id FK
        int quantity
        int reserved
        int min_threshold
        boolean alert_active
    }
    STOCK_MOVEMENT {
        uuid id PK
        uuid stock_id FK
        uuid product_id
        uuid warehouse_id
        string type "IN | OUT"
        int quantity
        string reason
        uuid order_id
        timestamp date
    }
    RESERVATION {
        uuid id PK
        uuid order_id UK
        jsonb items
        jsonb allocations
        string status "PENDING | RESERVED | RELEASED | CONSUMED"
    }
```

## Order

```mermaid
erDiagram
    ORDER ||--o{ ORDER_HISTORY : trace
    ORDER {
        uuid id PK
        uuid customer_id
        string customer_email
        string status "pending | validated | shipped | rejected | cancelled"
        string phase
        jsonb items
        numeric total
        int urgency
        timestamp required_by
        string rejection_reason
        uuid invoice_id
    }
    ORDER_HISTORY {
        uuid id PK
        uuid order_id FK
        string status
        string note
        timestamp at
    }
```

## Production

```mermaid
erDiagram
    MACHINE ||--o{ WORK_ORDER : exécute
    MACHINE {
        uuid id PK
        string name UK
        string category "cement | iron | brick | aggregate"
        int rate_per_minute
        string status "IDLE | BUSY | MAINTENANCE"
    }
    WORK_ORDER {
        uuid id PK
        uuid order_id
        uuid product_id
        string product_name
        string category
        int quantity
        int urgency
        float priority_score
        string status "QUEUED | IN_PROGRESS | COMPLETED | FAILED"
        float progress
        uuid machine_id FK
        timestamp required_by
        timestamp started_at
        timestamp completed_at
    }
```

## Billing

```mermaid
erDiagram
    INVOICE {
        uuid id PK
        string number UK
        uuid order_id UK
        uuid customer_id
        string customer_email
        jsonb lines
        numeric subtotal
        numeric tax
        numeric amount
        string currency
        string status "ISSUED | PAID | CANCELLED"
        string payment_method
        timestamp issued_at
        timestamp paid_at
    }
```

## Notification

```mermaid
erDiagram
    NOTIFICATION {
        uuid id PK
        string event_type
        string recipient
        string channel "EMAIL | LOG"
        string subject
        text body
        string status "SENT | FAILED"
        string correlation_id
        timestamp created_at
    }
```

## Reporting (modèles de lecture)

```mermaid
erDiagram
    SALE_LINE {
        uuid id PK
        uuid order_id
        uuid product_id
        string product_name
        int quantity
        numeric amount
        date day
    }
    STOCK_SNAPSHOT {
        uuid product_id PK
        uuid warehouse_id PK
        int quantity
        int reserved
        boolean low
        timestamp updated_at
    }
    PRODUCTION_STAT {
        uuid work_order_id PK
        uuid order_id
        uuid product_id
        string product_name
        int quantity
        timestamp completed_at
    }
    EVENT_LOG {
        uuid id PK
        uuid order_id
        string type
        jsonb payload
        string correlation_id
        timestamp at
    }
```
