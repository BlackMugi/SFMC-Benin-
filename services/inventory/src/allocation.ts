export interface StockLike {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  reserved: number;
}

export interface Allocation {
  productId: string;
  warehouseId: string;
  quantity: number;
}

export interface Shortage {
  productId: string;
  requested: number;
  available: number;
  missing: number;
}

export const available = (s: Pick<StockLike, 'quantity' | 'reserved'>) => s.quantity - s.reserved;

/**
 * Répartit une demande multi-produits sur les entrepôts, le plus approvisionné d'abord pour limiter
 * leur nombre. Tout ou rien : s'il manque quoi que ce soit, aucune allocation.
 */
export function allocate(stocks: StockLike[], items: { productId: string; quantity: number }[]): { allocations: Allocation[]; shortages: Shortage[] } {
  const allocations: Allocation[] = [];
  const shortages: Shortage[] = [];
  for (const item of items) {
    const candidates = stocks.filter((s) => s.productId === item.productId && available(s) > 0).sort((a, b) => available(b) - available(a));
    const totalAvailable = candidates.reduce((sum, s) => sum + available(s), 0);
    if (totalAvailable < item.quantity) {
      shortages.push({ productId: item.productId, requested: item.quantity, available: totalAvailable, missing: item.quantity - totalAvailable });
      continue;
    }
    let remaining = item.quantity;
    for (const s of candidates) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, available(s));
      allocations.push({ productId: item.productId, warehouseId: s.warehouseId, quantity: take });
      remaining -= take;
    }
  }
  return shortages.length ? { allocations: [], shortages } : { allocations, shortages };
}

/**
 * Seuil critique dynamique : max(seuil configuré, consommation moyenne par jour x délai de réapprovisionnement).
 */
export function criticalThreshold(minThreshold: number, avgDailyOut: number, leadTimeDays: number): number {
  return Math.max(minThreshold, Math.ceil(avgDailyOut * leadTimeDays));
}

export function mergeItems(items: { productId: string; quantity: number }[]) {
  const map = new Map<string, number>();
  for (const i of items) map.set(i.productId, (map.get(i.productId) ?? 0) + i.quantity);
  return [...map].map(([productId, quantity]) => ({ productId, quantity }));
}
