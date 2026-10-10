import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { ProductCategory } from '@sfmc/common';

export type MachineStatus = 'IDLE' | 'BUSY' | 'MAINTENANCE';

@Entity('machines')
export class Machine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  /** Catégorie de produit que la machine sait fabriquer */
  @Index()
  @Column({ type: 'varchar' })
  category: ProductCategory;

  /** Capacité nominale : unités produites par minute (simulée) */
  @Column({ name: 'rate_per_minute', type: 'int' })
  ratePerMinute: number;

  @Column({ type: 'varchar', default: 'IDLE' })
  status: MachineStatus;
}

export type WorkOrderStatus = 'QUEUED' | 'IN_PROGRESS' | 'QUALITY_CHECK' | 'COMPLETED' | 'FAILED';

@Entity('work_orders')
@Unique(['orderId', 'productId'])
export class WorkOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'product_name' })
  productName: string;

  @Column({ type: 'varchar' })
  category: ProductCategory;

  @Column({ type: 'int' })
  quantity: number;

  /** 1 (faible) à 5 (critique) */
  @Column({ type: 'int', default: 3 })
  urgency: number;

  @Column({ name: 'priority_score', type: 'float', default: 0 })
  priorityScore: number;

  @Index()
  @Column({ type: 'varchar', default: 'QUEUED' })
  status: WorkOrderStatus;

  /** Avancement 0-100 */
  @Column({ type: 'float', default: 0 })
  progress: number;

  @Column({ name: 'machine_id', type: 'uuid', nullable: true })
  machineId: string | null;

  @Column({ name: 'required_by', type: 'timestamptz', nullable: true })
  requiredBy: Date | null;

  /** Durée simulée de fabrication fixée au démarrage */
  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  /** Résultat du contrôle qualité : PASSED | FAILED (null tant que non inspecté) */
  @Column({ name: 'quality_result', type: 'varchar', nullable: true })
  qualityResult: 'PASSED' | 'FAILED' | null;

  @Column({ name: 'quality_notes', type: 'varchar', nullable: true })
  qualityNotes: string | null;

  @Column({ name: 'quality_checked_at', type: 'timestamptz', nullable: true })
  qualityCheckedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
