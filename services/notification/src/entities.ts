import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('notifications')
@Unique(['eventId', 'recipient'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** id de l'événement source : garantit une seule notification par (événement, destinataire) */
  @Column({ name: 'event_id' })
  eventId: string;

  @Index()
  @Column({ name: 'event_type' })
  eventType: string;

  @Index()
  @Column()
  recipient: string;

  @Column({ default: 'EMAIL' })
  channel: string;

  @Column()
  subject: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ default: 'SENT' })
  status: 'SENT' | 'FAILED';

  @Column({ name: 'correlation_id', type: 'varchar', nullable: true })
  correlationId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

/** Projection locale (alimentée par OrderCreated) : retrouver l'email du client à partir d'un orderId. */
@Entity('order_contacts')
export class OrderContact {
  @PrimaryColumn({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column()
  email: string;
}
