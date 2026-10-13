/** Catalogue des événements de domaine (clé de routage = type). */
export const EVENTS = {
  OrderCreated: 'OrderCreated',
  StockReserved: 'StockReserved',
  StockInsufficient: 'StockInsufficient',
  ProductionRequested: 'ProductionRequested',
  ProductionCompleted: 'ProductionCompleted',
  ProductionFailed: 'ProductionFailed',
  StockUpdated: 'StockUpdated',
  StockLow: 'StockLow',
  StockReleased: 'StockReleased',
  OrderValidated: 'OrderValidated',
  OrderRejected: 'OrderRejected',
  OrderCancelled: 'OrderCancelled',
  OrderShipped: 'OrderShipped',
  InvoiceIssued: 'InvoiceIssued',
  InvoicePaid: 'InvoicePaid',
} as const;
export type EventType = keyof typeof EVENTS;

export interface EventEnvelope<T = unknown> {
  id: string;
  type: EventType;
  occurredAt: string;
  correlationId: string;
  source: string;
  payload: T;
}

export type ProductCategory = 'cement' | 'iron' | 'brick' | 'aggregate';

export interface OrderLine {
  productId: string;
  productName: string;
  category: ProductCategory;
  quantity: number;
  unitPrice: number;
}

interface OrderRef {
  orderId: string;
  customerId: string;
  customerEmail: string;
}

export interface OrderCreatedPayload extends OrderRef { items: OrderLine[]; total: number; urgency: number; requiredBy?: string }
export interface StockReservedPayload { orderId: string; allocations: { productId: string; warehouseId: string; quantity: number }[] }
export interface StockInsufficientPayload { orderId: string; shortages: { productId: string; requested: number; available: number; missing: number }[] }
export interface ProductionRequestedPayload { orderId: string; productId: string; productName: string; category: ProductCategory; quantity: number; urgency: number; requiredBy?: string }
export interface ProductionCompletedPayload { workOrderId: string; orderId?: string; productId: string; productName: string; quantity: number; machineId: string }
export interface ProductionFailedPayload { workOrderId?: string; orderId?: string; productId: string; reason: string }
export interface StockUpdatedPayload { productId: string; warehouseId: string; quantity: number; reserved: number; movementType: 'IN' | 'OUT'; delta: number; reason: string; orderId?: string }
export interface StockLowPayload { productId: string; warehouseId: string; available: number; threshold: number }
export interface StockReleasedPayload { orderId: string }
export interface OrderValidatedPayload extends OrderRef { items: OrderLine[]; total: number }
export interface OrderRejectedPayload extends OrderRef { reason: string }
export interface OrderCancelledPayload extends OrderRef { reason: string }
export interface OrderShippedPayload extends OrderRef { items: OrderLine[] }
export interface InvoiceIssuedPayload extends OrderRef { invoiceId: string; number: string; amount: number; currency: string }
export interface InvoicePaidPayload { invoiceId: string; orderId: string; amount: number; method: string; customerEmail: string }

/** Contenu de chaque type d'événement. */
export interface EventPayloads {
  OrderCreated: OrderCreatedPayload;
  StockReserved: StockReservedPayload;
  StockInsufficient: StockInsufficientPayload;
  ProductionRequested: ProductionRequestedPayload;
  ProductionCompleted: ProductionCompletedPayload;
  ProductionFailed: ProductionFailedPayload;
  StockUpdated: StockUpdatedPayload;
  StockLow: StockLowPayload;
  StockReleased: StockReleasedPayload;
  OrderValidated: OrderValidatedPayload;
  OrderRejected: OrderRejectedPayload;
  OrderCancelled: OrderCancelledPayload;
  OrderShipped: OrderShippedPayload;
  InvoiceIssued: InvoiceIssuedPayload;
  InvoicePaid: InvoicePaidPayload;
}

/**
 * Événement reçu, typé selon son type : après un `switch (e.type)` le compilateur connaît le contenu de e.payload.
 */
export type DomainEvent = { [K in EventType]: EventEnvelope<EventPayloads[K]> & { type: K } }[EventType];

/** Commande concernée, s'il y en a une (StockLow et les mouvements manuels n'en ont pas). */
export function orderIdOf(e: DomainEvent): string | null {
  return 'orderId' in e.payload && typeof e.payload.orderId === 'string' ? e.payload.orderId : null;
}
