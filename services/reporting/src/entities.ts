import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { numericTransformer } from '@sfmc/common';

/** Ligne de vente (projection de OrderValidated) */
@Entity('sale_lines')
@Unique(['orderId', 'productId'])
export class SaleLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'product_name' })
  productName: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
  amount: number;

  @Index()
  @Column({ type: 'date' })
  day: string;
}

/** Dernier état connu d'un stock (projection de StockUpdated / StockLow) */
@Entity('stock_snapshots')
export class StockSnapshot {
  @PrimaryColumn({ name: 'product_id', type: 'uuid' })
  productId: string;

  @PrimaryColumn({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  @Column({ type: 'int', default: 0 })
  quantity: number;

  @Column({ type: 'int', default: 0 })
  reserved: number;

  @Column({ default: false })
  low: boolean;

  @Column({ name: 'low_threshold', type: 'int', nullable: true })
  lowThreshold: number | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** Production terminée (projection de ProductionCompleted) */
@Entity('production_stats')
export class ProductionStat {
  @PrimaryColumn({ name: 'work_order_id', type: 'uuid' })
  workOrderId: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'product_name' })
  productName: string;

  @Column({ type: 'int' })
  quantity: number;

  @CreateDateColumn({ name: 'completed_at', type: 'timestamptz' })
  completedAt: Date;
}

/** Journal de tous les événements (vue chronologique d'une commande, audit) */
@Entity('event_log')
export class EventLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'event_id' })
  eventId: string;

  @Index()
  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Index()
  @Column()
  type: string;

  @Column()
  source: string;

  @Column({ type: 'jsonb' })
  payload: unknown;

  @Column({ name: 'correlation_id', type: 'varchar', nullable: true })
  correlationId: string | null;

  @Index()
  @Column({ type: 'timestamptz' })
  at: Date;
}
