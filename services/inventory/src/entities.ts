import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('warehouses')
export class Warehouse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true })
  location: string | null;
}

@Entity('stocks')
@Unique(['productId', 'warehouseId'])
export class Stock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  @ManyToOne(() => Warehouse, { eager: false })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse?: Warehouse;

  /** Quantité physique en entrepôt */
  @Column({ type: 'int', default: 0 })
  quantity: number;

  /** Quantité réservée (disponible = quantity - reserved) */
  @Column({ type: 'int', default: 0 })
  reserved: number;

  /** Seuil minimal configuré ; le seuil effectif peut être plus haut (voir allocation.ts) */
  @Column({ name: 'min_threshold', type: 'int', default: 10 })
  minThreshold: number;

  /** Alerte déjà émise, évite les doublons tant que le stock n'est pas reconstitué */
  @Column({ name: 'alert_active', default: false })
  alertActive: boolean;
}

export type MovementType = 'IN' | 'OUT';

@Entity('stock_movements')
export class StockMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'stock_id', type: 'uuid' })
  stockId: string;

  @Index()
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  @Column({ type: 'varchar' })
  type: MovementType;

  @Column({ type: 'int' })
  quantity: number;

  /** PRODUCTION | PURCHASE | SALE | LOSS | ADJUSTMENT | TRANSFER | RETURN */
  @Column()
  reason: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  /** Référence d'idempotence (ex. id d'ordre de fabrication) */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  reference: string | null;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  date: Date;
}

export type ReservationStatus = 'PENDING' | 'RESERVED' | 'RELEASED' | 'CONSUMED';

export interface Allocation {
  productId: string;
  warehouseId: string;
  quantity: number;
}

@Entity('reservations')
export class Reservation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ type: 'jsonb' })
  items: { productId: string; quantity: number }[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  allocations: Allocation[];

  @Column({ type: 'varchar', default: 'PENDING' })
  status: ReservationStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
