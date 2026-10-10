import { buildPlan, durationMs, priorityScore } from './planning';

const now = new Date('2026-01-01T10:00:00Z');
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

describe('priorityScore', () => {
  it("l'urgence domine l'ancienneté", () => {
    const urgent = priorityScore({ urgency: 5, createdAt: now, requiredBy: null }, now);
    const old = priorityScore({ urgency: 3, createdAt: ago(120), requiredBy: null }, now);
    expect(urgent).toBeGreaterThan(old);
  });

  it("l'ancienneté départage à urgence égale (anti-famine)", () => {
    const a = priorityScore({ urgency: 3, createdAt: ago(60), requiredBy: null }, now);
    const b = priorityScore({ urgency: 3, createdAt: ago(1), requiredBy: null }, now);
    expect(a).toBeGreaterThan(b);
  });

  it('une échéance proche ou dépassée augmente la priorité', () => {
    const base = priorityScore({ urgency: 3, createdAt: now, requiredBy: null }, now);
    const soon = priorityScore({ urgency: 3, createdAt: now, requiredBy: new Date(now.getTime() + 3_600_000) }, now);
    const late = priorityScore({ urgency: 3, createdAt: now, requiredBy: ago(10) }, now);
    expect(soon).toBe(base + 50);
    expect(late).toBe(base + 100);
  });
});

describe('durationMs', () => {
  it('applique le facteur de simulation et un plancher', () => {
    expect(durationMs(600, 10, 60, 1)).toBe(60_000); // 60 min simulées / 60
    expect(durationMs(1, 1000, 120, 6)).toBe(6000); // plancher 6 s
  });
});

describe('buildPlan', () => {
  const machines = [{ id: 'm1', ratePerMinute: 10, status: 'IDLE' as const }];

  it('ordonne par priorité et enchaîne les créneaux sur la machine unique', () => {
    const plan = buildPlan(
      [
        { id: 'low', urgency: 1, createdAt: now, requiredBy: null, quantity: 100 },
        { id: 'high', urgency: 5, createdAt: now, requiredBy: null, quantity: 100 },
      ],
      machines,
      now,
      60,
      1,
    );
    expect(plan.map((p) => p.workOrderId)).toEqual(['high', 'low']);
    expect(plan[0].estimatedStart).toEqual(now);
    expect(plan[1].estimatedStart).toEqual(plan[0].estimatedEnd);
  });

  it("répartit sur les machines libres et ignore celles en maintenance", () => {
    const plan = buildPlan(
      [
        { id: 'a', urgency: 3, createdAt: now, requiredBy: null, quantity: 100 },
        { id: 'b', urgency: 3, createdAt: now, requiredBy: null, quantity: 100 },
      ],
      [{ id: 'm1', ratePerMinute: 10, status: 'IDLE' }, { id: 'm2', ratePerMinute: 10, status: 'IDLE' }, { id: 'm3', ratePerMinute: 10, status: 'MAINTENANCE' }],
      now,
      60,
      1,
    );
    expect(new Set(plan.map((p) => p.machineId))).toEqual(new Set(['m1', 'm2']));
  });

  it("sans machine disponible l'ordre reste non planifié", () => {
    const plan = buildPlan([{ id: 'a', urgency: 3, createdAt: now, requiredBy: null, quantity: 5 }], [{ id: 'm1', ratePerMinute: 10, status: 'MAINTENANCE' }], now, 60, 1);
    expect(plan[0].machineId).toBeNull();
  });
});
