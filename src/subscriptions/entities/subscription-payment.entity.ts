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
import { numericTransformer } from '../../payments/common/numeric.transformer';
import { User } from '../../users/entities/user.entity';
import { SubscriptionPeriod } from '../subscription-period.enum';
import { Subscription } from './subscription.entity';

export enum SubscriptionPaymentStatus {
  COMPLETED = 'completed',
  FAILED = 'failed',
}

// Intento de pago de la suscripción. Va aparte de payment_transaction: solo
// comparte la pasarela simulada y la validación de tarjeta.
@Entity('subscription_payment')
@Unique('UQ_subscription_payment_idempotency_key', ['idempotencyKey'])
@Index('IDX_subscription_payment_user_id_created_at', ['userId', 'createdAt'])
export class SubscriptionPayment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Null en el pago rechazado de quien todavía no tiene suscripción.
  @Column({ name: 'subscription_id', type: 'uuid', nullable: true })
  subscriptionId!: string | null;

  @ManyToOne(() => Subscription, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subscription_id', referencedColumnName: 'id' })
  subscription!: Subscription | null;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user!: User;

  @Column({ type: 'enum', enum: SubscriptionPeriod })
  period!: SubscriptionPeriod;

  // Lo cobrado, en la moneda del catálogo.
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: numericTransformer,
  })
  amount!: number;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'enum', enum: SubscriptionPaymentStatus })
  status!: SubscriptionPaymentStatus;

  @Column({ name: 'failure_reason', type: 'varchar', nullable: true })
  failureReason!: string | null;

  @Column({ name: 'gateway_reference', type: 'varchar', nullable: true })
  gatewayReference!: string | null;

  @Column({ name: 'card_brand', type: 'varchar', nullable: true })
  cardBrand!: string | null;

  @Column({ name: 'card_last4', type: 'char', length: 4, nullable: true })
  cardLast4!: string | null;

  // Solo se guarda si el pago se aprueba, como en los pagos de productos.
  @Column({
    name: 'card_holder_name',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  cardHolderName!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar' })
  idempotencyKey!: string;

  // Precio que se le mostró al usuario en su moneda (informativo).
  @Column({
    name: 'display_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  displayAmount!: number | null;

  @Column({
    name: 'display_currency',
    type: 'varchar',
    length: 3,
    nullable: true,
  })
  displayCurrency!: string | null;

  @Column({
    name: 'exchange_rate',
    type: 'numeric',
    precision: 18,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  exchangeRate!: number | null;

  // Tramo que cubre un pago aprobado.
  @Column({
    name: 'covers_from',
    type: 'timestamp with time zone',
    nullable: true,
  })
  coversFrom!: Date | null;

  @Column({
    name: 'covers_until',
    type: 'timestamp with time zone',
    nullable: true,
  })
  coversUntil!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;
}
