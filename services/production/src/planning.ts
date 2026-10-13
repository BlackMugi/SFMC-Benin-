export interface PlannableOrder {
  id: string;
  urgency: number;
  createdAt: Date;
  requiredBy: Date | null;
  quantity: number;
}

export interface PlannableMachine {
  id: string;
  ratePerMinute: number;
  status: 'IDLE' | 'BUSY' | 'MAINTENANCE';
  /** Instant où la machine sera libre (si elle est occupée) */
  busyUntil?: Date | null;
}

/**
 * Priorité d'un ordre (plus grand = plus prioritaire) :
 *  - urgence 1..5 : 100 points par niveau, critère dominant ;
 *  - ancienneté : +0,5 point par minute d'attente, plafonné à 2 h, pour éviter la famine ;
 *  - échéance : +50 si due sous 24 h, +100 si dépassée.
 */
export function priorityScore(o: Pick<PlannableOrder, 'urgency' | 'createdAt' | 'requiredBy'>, now = new Date()): number {
  const ageMin = Math.min(120, Math.max(0, (now.getTime() - o.createdAt.getTime()) / 60_000));
  let deadline = 0;
  if (o.requiredBy) {
    const left = o.requiredBy.getTime() - now.getTime();
    if (left < 0) deadline = 100;
    else if (left < 24 * 3_600_000) deadline = 50;
  }
  return o.urgency * 100 + ageMin * 0.5 + deadline;
}

/** Durée simulée (ms) : quantité / cadence, accélérée par le facteur de simulation, avec un plancher. */
export function durationMs(quantity: number, ratePerMinute: number, speedFactor: number, minSeconds: number): number {
  const realMs = ((quantity / ratePerMinute) * 60_000) / Math.max(1, speedFactor);
  return Math.max(minSeconds * 1000, Math.round(realMs));
}

export interface PlanEntry {
  workOrderId: string;
  rank: number;
  score: number;
  machineId: string | null;
  estimatedStart: Date | null;
  estimatedEnd: Date | null;
}

/**
 * Planification gloutonne : tri par priorité décroissante, chaque ordre va à la machine compatible
 * libre le plus tôt.
 */
export function buildPlan(
  queued: PlannableOrder[],
  machines: PlannableMachine[],
  now: Date,
  speedFactor: number,
  minSeconds: number,
): PlanEntry[] {
  const free = new Map<string, number>();
  for (const m of machines) if (m.status !== 'MAINTENANCE') free.set(m.id, Math.max(now.getTime(), m.busyUntil?.getTime() ?? 0));
  const sorted = queued.map((q) => ({ q, score: priorityScore(q, now) })).sort((a, b) => b.score - a.score || a.q.createdAt.getTime() - b.q.createdAt.getTime());
  return sorted.map(({ q, score }, i) => {
    let best: PlannableMachine | undefined;
    for (const m of machines) {
      if (!free.has(m.id)) continue;
      if (!best || free.get(m.id)! < free.get(best.id)!) best = m;
    }
    if (!best) return { workOrderId: q.id, rank: i + 1, score, machineId: null, estimatedStart: null, estimatedEnd: null };
    const start = free.get(best.id)!;
    const end = start + durationMs(q.quantity, best.ratePerMinute, speedFactor, minSeconds);
    free.set(best.id, end);
    return { workOrderId: q.id, rank: i + 1, score, machineId: best.id, estimatedStart: new Date(start), estimatedEnd: new Date(end) };
  });
}
