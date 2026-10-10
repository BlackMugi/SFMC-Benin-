import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('oauth_clients')
export class OAuthClient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_id', unique: true })
  clientId: string;

  @Column({ name: 'secret_hash' })
  secretHash: string;

  @Column()
  name: string;

  /** "service" (inter-services) ou "partner" (intégration externe) */
  @Column({ type: 'varchar' })
  role: 'service' | 'partner';

  @Column({ type: 'text', array: true, default: '{}' })
  scopes: string[];

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
