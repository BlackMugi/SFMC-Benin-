import { EventEnvelope, OrderValidatedPayload } from '@sfmc/common';

/** Fonctions pures de projection : événement -> lignes des vues de lecture. */

export function saleLinesFrom(e: EventEnvelope<OrderValidatedPayload>) {
  const day = e.occurredAt.slice(0, 10);
  return e.payload.items.map((i) => ({
    orderId: e.payload.orderId,
    productId: i.productId,
    productName: i.productName,
    quantity: i.quantity,
    amount: Math.round(i.quantity * i.unitPrice * 100) / 100,
    day,
  }));
}

/**
 * Met à jour un instantané de stock. Le drapeau "low" est levé par StockLow et baissé quand
 * une entrée de stock ramène le disponible au-dessus du seuil mémorisé.
 */
export function applyStockUpdated(
  prev: { low: boolean; lowThreshold: number | null } | undefined,
  p: { quantity: number; reserved: number; movementType: 'IN' | 'OUT' },
) {
  let low = prev?.low ?? false;
  const threshold = prev?.lowThreshold ?? null;
  if (low && p.movementType === 'IN' && threshold !== null && p.quantity - p.reserved > threshold) low = false;
  return { quantity: p.quantity, reserved: p.reserved, low, lowThreshold: low ? threshold : null };
}
