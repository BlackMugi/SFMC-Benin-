import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '@sfmc/common';

export type InvoiceStatus = 'ISSUED' | 'PAID' | 'CANCELLED';

export interface InvoiceLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  number: string;

  /** Une facture par commande (clé d'idempotence de la saga) */
  @Index({ unique: true })
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Index()
  @Column({ name: 'customer_id' })
  customerId: string;

  @Column({ name: 'customer_email', type: 'varchar', nullable: true })
  customerEmail: string | null;

  @Column({ type: 'jsonb' })
  lines: InvoiceLine[];

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
  subtotal: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
  tax: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
  amount: number;

  @Column({ default: 'XOF' })
  currency: string;

  @Column({ type: 'varchar', default: 'ISSUED' })
  status: InvoiceStatus;

  @Column({ name: 'payment_method', type: 'varchar', nullable: true })
  paymentMethod: string | null;

  @Column({ name: 'payment_reference', type: 'varchar', nullable: true })
  paymentReference: string | null;

  @CreateDateColumn({ name: 'issued_at', type: 'timestamptz' })
  issuedAt: Date;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;
}
