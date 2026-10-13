import { ContractViolationError, EVENT_CONTRACTS, assertContract, contractViolations } from './contracts';
import { EVENTS, EventType } from './events';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ref = { orderId: id(1), customerId: id(2), customerEmail: 'awa@sfmc.bj' };
const line = { productId: id(3), productName: 'Ciment CPJ 42.5', category: 'cement', quantity: 100, unitPrice: 6500 };

/** Un exemple conforme par événement. */
const EXAMPLES: Record<EventType, Record<string, unknown>> = {
  OrderCreated: { ...ref, items: [line], total: 650000, urgency: 5, requiredBy: '2026-11-01T00:00:00.000Z' },
  StockReserved: { orderId: id(1), allocations: [{ productId: id(3), warehouseId: id(4), quantity: 100 }] },
  StockInsufficient: { orderId: id(1), shortages: [{ productId: id(3), requested: 100, available: 20, missing: 80 }] },
  ProductionRequested: { orderId: id(1), productId: id(3), productName: 'Ciment', category: 'cement', quantity: 80, urgency: 5 },
  ProductionCompleted: { workOrderId: id(5), orderId: id(1), productId: id(3), productName: 'Ciment', quantity: 80, machineId: id(6) },
  ProductionFailed: { orderId: id(1), productId: id(3), reason: 'Lot non conforme' },
  StockUpdated: { productId: id(3), warehouseId: id(4), quantity: 100, reserved: 0, movementType: 'IN', delta: 80, reason: 'PRODUCTION', orderId: id(1) },
  StockLow: { productId: id(3), warehouseId: id(4), available: 3, threshold: 10.5 },
  StockReleased: { orderId: id(1) },
  OrderValidated: { ...ref, items: [line], total: 650000 },
  OrderRejected: { ...ref, reason: 'Production impossible' },
  OrderCancelled: { ...ref, reason: 'Annulée par le client' },
  OrderShipped: { ...ref, items: [line] },
  InvoiceIssued: { ...ref, invoiceId: id(7), number: 'INV-2026-000001', amount: 767000, currency: 'XOF' },
  InvoicePaid: { invoiceId: id(7), orderId: id(1), amount: 767000, method: 'MOBILE_MONEY', customerEmail: 'awa@sfmc.bj' },
};

describe('contrats des événements', () => {
  it('couvrent chaque type d’événement du catalogue', () => {
    expect(Object.keys(EVENT_CONTRACTS).sort()).toEqual(Object.keys(EVENTS).sort());
  });

  it.each(Object.keys(EVENTS) as EventType[])('%s : l’exemple de référence est conforme', (type) => {
    expect(contractViolations(type, EXAMPLES[type])).toEqual([]);
  });

  it.each(Object.keys(EVENTS) as EventType[])('%s : chaque champ obligatoire manquant est détecté', (type) => {
    const required = Object.entries(EVENT_CONTRACTS[type]).filter(([, f]) => !f.optional).map(([k]) => k);
    expect(required.length).toBeGreaterThan(0);
    for (const field of required) {
      const { [field]: _removed, ...rest } = EXAMPLES[type];
      expect(contractViolations(type, rest)).toContain(`${field} : obligatoire`);
    }
  });

  it('tolère un champ supplémentaire (évolution compatible d’un producteur)', () => {
    expect(contractViolations('StockReleased', { orderId: id(1), nouveauChamp: 'x' })).toEqual([]);
  });

  it('détecte les mauvais types, formats et valeurs, y compris dans les tableaux', () => {
    expect(contractViolations('OrderCreated', { ...EXAMPLES.OrderCreated, total: '650000' })).toContain('total : nombre attendu');
    expect(contractViolations('OrderCreated', { ...EXAMPLES.OrderCreated, orderId: 'commande-1' })).toContain('orderId : UUID attendu');
    expect(contractViolations('OrderCreated', { ...EXAMPLES.OrderCreated, requiredBy: 'demain' })).toContain('requiredBy : date ISO 8601 attendue');
    expect(contractViolations('OrderCreated', { ...EXAMPLES.OrderCreated, items: [] })).toContain('items : au moins 1 élément(s)');
    expect(contractViolations('OrderCreated', { ...EXAMPLES.OrderCreated, items: [{ ...line, category: 'bois' }] })).toContain('items[0].category : valeur « bois » hors de [cement, iron, brick, aggregate]');
    expect(contractViolations('OrderCreated', { ...EXAMPLES.OrderCreated, items: [{ ...line, quantity: 1.5 }] })).toContain('items[0].quantity : entier attendu');
    expect(contractViolations('StockUpdated', { ...EXAMPLES.StockUpdated, movementType: 'SIDEWAYS' })[0]).toMatch(/movementType/);
    expect(contractViolations('StockReserved', { ...EXAMPLES.StockReserved, allocations: [{ productId: id(3), warehouseId: id(4), quantity: 0 }] })).toContain('allocations[0].quantity : minimum 1');
  });

  it('refuse un type inconnu et un contenu qui n’est pas un objet', () => {
    expect(contractViolations('OrderTeleported', {})).toEqual(["type d'événement inconnu : OrderTeleported"]);
    expect(contractViolations('StockReleased', null)).toEqual(['payload : objet attendu']);
    expect(() => assertContract('StockReleased', { orderId: 42 })).toThrow(ContractViolationError);
  });
});
