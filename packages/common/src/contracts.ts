import {
  EventType,
  InvoiceIssuedPayload,
  InvoicePaidPayload,
  OrderCancelledPayload,
  OrderCreatedPayload,
  OrderRejectedPayload,
  OrderShippedPayload,
  OrderValidatedPayload,
  ProductionCompletedPayload,
  ProductionFailedPayload,
  ProductionRequestedPayload,
  StockInsufficientPayload,
  StockLowPayload,
  StockReleasedPayload,
  StockReservedPayload,
  StockUpdatedPayload,
} from './events';

/**
 * Contrats des événements : format exact de chaque message échangé entre services.
 * - Compilation : SchemaFor<T> impose que le contrat liste exactement les champs de l'interface TypeScript.
 * - Exécution : l'Outbox refuse un événement non conforme (transaction annulée) ; le bus envoie un message reçu
 *   non conforme directement en dead-letter. Les champs supplémentaires sont tolérés à la réception (évolution
 *   compatible : un producteur peut ajouter un champ sans casser ses consommateurs).
 */

type Kind = 'string' | 'number' | 'integer' | 'uuid' | 'datetime';
export type Field =
  | { kind: Kind; optional?: boolean; min?: number; values?: readonly string[] }
  | { kind: 'array'; optional?: boolean; of: Schema; minItems?: number }
  | { kind: 'object'; optional?: boolean; of: Schema };
export type Schema = Record<string, Field>;
/** Un contrat par interface : mêmes clés, ni plus ni moins (vérifié par le compilateur). */
type SchemaFor<T> = { [K in keyof Required<T>]: Field };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES = ['cement', 'iron', 'brick', 'aggregate'] as const;

const uuid = (optional = false): Field => ({ kind: 'uuid', optional });
const str = (optional = false): Field => ({ kind: 'string', optional });
const int = (min?: number): Field => ({ kind: 'integer', min });
const num = (min?: number): Field => ({ kind: 'number', min });

const orderLine: Schema = {
  productId: uuid(),
  productName: str(),
  category: { kind: 'string', values: CATEGORIES },
  quantity: int(1),
  unitPrice: num(0),
};
// customerEmail peut être vide (compte sans e-mail connu) : chaîne, pas d'exigence de format
const orderRef = { orderId: uuid(), customerId: uuid(), customerEmail: str() };

const OrderCreated: SchemaFor<OrderCreatedPayload> = {
  ...orderRef,
  items: { kind: 'array', of: orderLine, minItems: 1 },
  total: num(0),
  urgency: { kind: 'integer', min: 1 },
  requiredBy: { kind: 'datetime', optional: true },
};
const StockReserved: SchemaFor<StockReservedPayload> = {
  orderId: uuid(),
  allocations: { kind: 'array', of: { productId: uuid(), warehouseId: uuid(), quantity: int(1) } },
};
const StockInsufficient: SchemaFor<StockInsufficientPayload> = {
  orderId: uuid(),
  shortages: { kind: 'array', minItems: 1, of: { productId: uuid(), requested: int(1), available: int(0), missing: int(1) } },
};
const ProductionRequested: SchemaFor<ProductionRequestedPayload> = {
  orderId: uuid(),
  productId: uuid(),
  productName: str(),
  category: { kind: 'string', values: CATEGORIES },
  quantity: int(1),
  urgency: int(1),
  requiredBy: { kind: 'datetime', optional: true },
};
const ProductionCompleted: SchemaFor<ProductionCompletedPayload> = {
  workOrderId: uuid(),
  orderId: uuid(true),
  productId: uuid(),
  productName: str(),
  quantity: int(1),
  machineId: str(), // vide pour un ordre sans machine
};
const ProductionFailed: SchemaFor<ProductionFailedPayload> = { workOrderId: uuid(true), orderId: uuid(true), productId: uuid(), reason: str() };
const StockUpdated: SchemaFor<StockUpdatedPayload> = {
  productId: uuid(),
  warehouseId: uuid(),
  quantity: int(),
  reserved: int(0),
  movementType: { kind: 'string', values: ['IN', 'OUT'] },
  delta: int(),
  reason: str(),
  orderId: uuid(true),
};
const StockLow: SchemaFor<StockLowPayload> = { productId: uuid(), warehouseId: uuid(), available: int(), threshold: num(0) };
const StockReleased: SchemaFor<StockReleasedPayload> = { orderId: uuid() };
const OrderValidated: SchemaFor<OrderValidatedPayload> = { ...orderRef, items: { kind: 'array', of: orderLine, minItems: 1 }, total: num(0) };
const OrderRejected: SchemaFor<OrderRejectedPayload> = { ...orderRef, reason: str() };
const OrderCancelled: SchemaFor<OrderCancelledPayload> = { ...orderRef, reason: str() };
const OrderShipped: SchemaFor<OrderShippedPayload> = { ...orderRef, items: { kind: 'array', of: orderLine, minItems: 1 } };
const InvoiceIssued: SchemaFor<InvoiceIssuedPayload> = { ...orderRef, invoiceId: uuid(), number: str(), amount: num(0), currency: str() };
const InvoicePaid: SchemaFor<InvoicePaidPayload> = { invoiceId: uuid(), orderId: uuid(), amount: num(0), method: str(), customerEmail: str() };

/** Un contrat par type d'événement (le compilateur refuse un type sans contrat). */
export const EVENT_CONTRACTS: Record<EventType, Schema> = {
  OrderCreated,
  StockReserved,
  StockInsufficient,
  ProductionRequested,
  ProductionCompleted,
  ProductionFailed,
  StockUpdated,
  StockLow,
  StockReleased,
  OrderValidated,
  OrderRejected,
  OrderCancelled,
  OrderShipped,
  InvoiceIssued,
  InvoicePaid,
};

function checkField(path: string, value: unknown, f: Field, errors: string[]) {
  if (value === undefined || value === null) {
    if (!f.optional) errors.push(`${path} : obligatoire`);
    return;
  }
  switch (f.kind) {
    case 'array':
      if (!Array.isArray(value)) return void errors.push(`${path} : tableau attendu`);
      if (f.minItems !== undefined && value.length < f.minItems) errors.push(`${path} : au moins ${f.minItems} élément(s)`);
      value.forEach((v, i) => checkObject(`${path}[${i}]`, v, f.of, errors));
      return;
    case 'object':
      return checkObject(path, value, f.of, errors);
    case 'uuid':
      if (typeof value !== 'string' || !UUID.test(value)) errors.push(`${path} : UUID attendu`);
      return;
    case 'datetime':
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) errors.push(`${path} : date ISO 8601 attendue`);
      return;
    case 'string':
      if (typeof value !== 'string') return void errors.push(`${path} : texte attendu`);
      if (f.values && !f.values.includes(value)) errors.push(`${path} : valeur « ${value} » hors de [${f.values.join(', ')}]`);
      return;
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value)) return void errors.push(`${path} : nombre attendu`);
      if (f.kind === 'integer' && !Number.isInteger(value)) errors.push(`${path} : entier attendu`);
      if (f.min !== undefined && value < f.min) errors.push(`${path} : minimum ${f.min}`);
      return;
  }
}

function checkObject(path: string, value: unknown, schema: Schema, errors: string[]) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return void errors.push(`${path || 'payload'} : objet attendu`);
  for (const [key, field] of Object.entries(schema)) checkField(path ? `${path}.${key}` : key, (value as Record<string, unknown>)[key], field, errors);
}

/** Liste des écarts au contrat (vide si conforme). */
export function contractViolations(type: string, payload: unknown): string[] {
  const schema = EVENT_CONTRACTS[type as EventType];
  if (!schema) return [`type d'événement inconnu : ${type}`];
  const errors: string[] = [];
  checkObject('', payload, schema, errors);
  return errors;
}

export class ContractViolationError extends Error {
  constructor(type: string, readonly violations: string[]) {
    super(`Contrat ${type} non respecté : ${violations.join(' ; ')}`);
  }
}

export function assertContract(type: string, payload: unknown): void {
  const violations = contractViolations(type, payload);
  if (violations.length) throw new ContractViolationError(type, violations);
}
