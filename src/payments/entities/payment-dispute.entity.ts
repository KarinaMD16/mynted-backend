import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { PaymentTransaction } from './payment-transaction.entity';
import { PaymentDisputeStatus } from '../enums/payment-dispute-status.enum';

@Entity('payment_dispute')
@Unique('UQ_payment_dispute_transaction_id', ['transactionId'])
@Index('IDX_payment_dispute_status_created_at', ['status', 'createdAt'])
export class PaymentDispute {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'transaction_id', type: 'uuid' })
  transactionId!: string;

  @ManyToOne(() => PaymentTransaction, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'transaction_id', referencedColumnName: 'id' })
  transaction!: PaymentTransaction;

  @Column({ name: 'buyer_id', type: 'uuid' })
  buyerId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'buyer_id', referencedColumnName: 'id' })
  buyer!: User;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'enum', enum: PaymentDisputeStatus })
  status!: PaymentDisputeStatus;

  @Column({ type: 'varchar', nullable: true })
  resolution!: string | null;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote!: string | null;

  @Column({ name: 'resolved_by_user_id', type: 'uuid', nullable: true })
  resolvedByUserId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resolved_by_user_id', referencedColumnName: 'id' })
  resolvedBy!: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @Column({
    name: 'resolved_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  resolvedAt!: Date | null;
}
