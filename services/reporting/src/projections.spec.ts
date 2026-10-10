import { EventEnvelope } from '@sfmc/common';
import { applyStockUpdated, orderIdOf, saleLinesFrom } from './projections';

const evt = (type: string, payload: any): EventEnvelope<any> => ({ id: 'e', type: type as any, occurredAt: '2026-03-05T09:30:00.000Z', correlationId: 'c', source: 's', payload });

describe('projections', () => {
  it('OrderValidated -> lignes de vente datées avec montant par ligne', () => {
    const lines = saleLinesFrom(
      evt('OrderValidated', { orderId: 'o1', items: [{ productId: 'p1', productName: 'Ciment', quantity: 100, unitPrice: 6500 }, { productId: 'p2', productName: 'Fer', quantity: 2, unitPrice: 7800.5 }] }),
    );
    expect(lines).toEqual([
      { orderId: 'o1', productId: 'p1', productName: 'Ciment', quantity: 100, amount: 650000, day: '2026-03-05' },
      { orderId: 'o1', productId: 'p2', productName: 'Fer', quantity: 2, amount: 15601, day: '2026-03-05' },
    ]);
  });

  it('StockUpdated : lève puis baisse le drapeau "low" selon le seuil mémorisé', () => {
    const low = { low: true, lowThreshold: 10 };
    expect(applyStockUpdated(low, { quantity: 15, reserved: 10, movementType: 'IN' }).low).toBe(true); // disponible 5 <= 10
    expect(applyStockUpdated(low, { quantity: 100, reserved: 10, movementType: 'IN' })).toMatchObject({ low: false, lowThreshold: null });
    expect(applyStockUpdated(low, { quantity: 100, reserved: 0, movementType: 'OUT' }).low).toBe(true); // une sortie ne ré-arme pas
    expect(applyStockUpdated(undefined, { quantity: 5, reserved: 0, movementType: 'IN' }).low).toBe(false);
  });

  it('extrait orderId quand il existe', () => {
    expect(orderIdOf(evt('StockLow', { productId: 'x' }))).toBeNull();
    expect(orderIdOf(evt('OrderCreated', { orderId: 'o9' }))).toBe('o9');
  });
});
