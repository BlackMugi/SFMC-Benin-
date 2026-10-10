import { OrderStatus } from './entities';

/** Machine à états du cycle de vie : pending → validated → shipped (+ rejected / cancelled). */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['validated', 'rejected', 'cancelled'],
  validated: ['shipped', 'cancelled'],
  shipped: [],
  rejected: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuts source autorisés pour atteindre `to` */
export function sourcesFor(to: OrderStatus): OrderStatus[] {
  return (Object.keys(TRANSITIONS) as OrderStatus[]).filter((from) => canTransition(from, to));
}
