import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { OrderLine, numericTransformer } from '@sfmc/common';

export type OrderStatus = 'pending' | 'validated' | 'shipped' | 'rejected' | 'cancelled';
/** Sous-phase d'une commande pending */
export type OrderPhase = 'awaiting_stock' | 'awaiting_production' | 'production_completed' | 'validated' | 'shipped' | 'closed';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'customer_id' })
  customerId: string;

  @Column({ name: 'customer_email', type: 'varchar', nullable: true })
  customerEmail: string | null;

  @Index()
  @Column({ type: 'varchar', default: 'pending' })
  status: OrderStatus;

  @Column({ type: 'varchar', default: 'awaiting_stock' })
  phase: OrderPhase;

  @Column({ type: 'jsonb' })
  items: OrderLine[];

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
  total: number;

  /** 1 (faible) à 5 (critique) : sert à prioriser la production */
  @Column({ type: 'int', default: 3 })
  urgency: number;

  @Column({ name: 'required_by', type: 'timestamptz', nullable: true })
  requiredBy: Date | null;

  /** Résultat de la vérification REST synchrone auprès d'Inventory (informatif) */
  @Column({ name: 'stock_check', type: 'jsonb', nullable: true })
  stockCheck: unknown;

  @Column({ name: 'rejection_reason', type: 'varchar', nullable: true })
  rejectionReason: string | null;

  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoiceId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity('order_history')
export class OrderHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column()
  status: string;

  @Column()
  note: string;

  @CreateDateColumn({ type: 'timestamptz' })
  at: Date;
}
