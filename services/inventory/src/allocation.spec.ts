import { allocate, criticalThreshold, mergeItems } from './allocation';

const stock = (id: string, productId: string, warehouseId: string, quantity: number, reserved = 0) => ({ id, productId, warehouseId, quantity, reserved });

describe('allocate', () => {
  it('alloue sur un seul entrepôt quand il suffit', () => {
    const r = allocate([stock('1', 'P', 'W1', 50), stock('2', 'P', 'W2', 10)], [{ productId: 'P', quantity: 30 }]);
    expect(r.shortages).toEqual([]);
    expect(r.allocations).toEqual([{ productId: 'P', warehouseId: 'W1', quantity: 30 }]);
  });

  it('répartit sur plusieurs entrepôts (multi-entrepôts)', () => {
    const r = allocate([stock('1', 'P', 'W1', 20), stock('2', 'P', 'W2', 15)], [{ productId: 'P', quantity: 30 }]);
    expect(r.allocations).toEqual([
      { productId: 'P', warehouseId: 'W1', quantity: 20 },
      { productId: 'P', warehouseId: 'W2', quantity: 10 },
    ]);
  });

  it('ignore la quantité déjà réservée', () => {
    const r = allocate([stock('1', 'P', 'W1', 100, 90)], [{ productId: 'P', quantity: 20 }]);
    expect(r.allocations).toEqual([]);
    expect(r.shortages).toEqual([{ productId: 'P', requested: 20, available: 10, missing: 10 }]);
  });

  it('tout ou rien : un article manquant annule toute allocation', () => {
    const r = allocate([stock('1', 'A', 'W1', 100), stock('2', 'B', 'W1', 1)], [{ productId: 'A', quantity: 10 }, { productId: 'B', quantity: 5 }]);
    expect(r.allocations).toEqual([]);
    expect(r.shortages).toHaveLength(1);
    expect(r.shortages[0]).toMatchObject({ productId: 'B', missing: 4 });
  });

  it('produit sans aucun stock : tout est manquant', () => {
    const r = allocate([], [{ productId: 'Z', quantity: 7 }]);
    expect(r.shortages).toEqual([{ productId: 'Z', requested: 7, available: 0, missing: 7 }]);
  });
});

describe('criticalThreshold', () => {
  it('garde le seuil configuré quand la consommation est faible', () => {
    expect(criticalThreshold(10, 1, 2)).toBe(10);
  });
  it('monte avec la consommation moyenne x délai de réappro', () => {
    expect(criticalThreshold(10, 12.4, 2)).toBe(25);
  });
});

describe('mergeItems', () => {
  it('cumule les quantités d\'un même produit', () => {
    expect(mergeItems([{ productId: 'A', quantity: 2 }, { productId: 'A', quantity: 3 }, { productId: 'B', quantity: 1 }])).toEqual([
      { productId: 'A', quantity: 5 },
      { productId: 'B', quantity: 1 },
    ]);
  });
});
