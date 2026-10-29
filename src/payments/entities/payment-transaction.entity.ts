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
import { Product } from '../../products/entities/product.entity';
import { Seller } from '../../sellers/entities/seller.entity';
import { User } from '../../users/entities/user.entity';
import { numericTransformer } from '../common/numeric.transformer';
import { TransactionStatus } from '../enums/transaction-status.enum';
import { ShippingAddressSnapshot } from '../types/shipping-address-snapshot';
import { ShippingStatus } from '../enums/shipping-status.enum';

@Entity('payment_transaction')
@Unique('UQ_payment_transaction_idempotency_key', ['idempotencyKey'])
@Index('IDX_payment_transaction_seller_status', ['sellerId', 'status'])
@Index('IDX_payment_transaction_buyer_created_at', ['buyerId', 'createdAt'])
export class PaymentTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'product_id' })
  productId!: number;

  @ManyToOne(() => Product, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id', referencedColumnName: 'id' })
  product!: Product;

  @Column({ name: 'buyer_id', type: 'uuid' })
  buyerId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'buyer_id', referencedColumnName: 'id' })
  buyer!: User;

  @Column({ name: 'seller_id' })
  sellerId!: number;

  @ManyToOne(() => Seller, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'seller_id', referencedColumnName: 'sellerId' })
  seller!: Seller;

  // Unidades compradas. amount es el total: unitPrice × quantity.
  @Column({ type: 'int', default: 1 })
  quantity!: number;

  // Precio unitario al momento del pago (null en transacciones anteriores).
  @Column({
    name: 'unit_price',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  unitPrice!: number | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: numericTransformer,
  })
  amount!: number;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({
    name: 'exchange_rate',
    type: 'numeric',
    precision: 18,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  exchangeRate!: number | null;

  @Column({
    name: 'normalized_amount_crc',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  normalizedAmountCrc!: number | null;

  @Column({ name: 'sales_tier_name', type: 'varchar' })
  salesTierName!: string;

  @Column({
    name: 'sales_discount',
    type: 'numeric',
    precision: 5,
    scale: 4,
    transformer: numericTransformer,
  })
  salesDiscount!: number;

  @Column({ name: 'price_tier_name', type: 'varchar' })
  priceTierName!: string;

  @Column({
    name: 'price_discount',
    type: 'numeric',
    precision: 5,
    scale: 4,
    transformer: numericTransformer,
  })
  priceDiscount!: number;

  @Column({
    name: 'commission_rate',
    type: 'numeric',
    precision: 5,
    scale: 4,
    transformer: numericTransformer,
  })
  commissionRate!: number;

  @Column({
    name: 'commission_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: numericTransformer,
  })
  commissionAmount!: number;

  @Column({
    name: 'seller_net',
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: numericTransformer,
  })
  sellerNet!: number;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status!: TransactionStatus;

  @Column({ name: 'failure_reason', type: 'varchar', nullable: true })
  failureReason!: string | null;

  @Column({ name: 'card_brand', type: 'varchar', nullable: true })
  cardBrand!: string | null;

  @Column({ name: 'card_last4', type: 'char', length: 4, nullable: true })
  cardLast4!: string | null;

  // Nullable: las transacciones anteriores a este campo no lo tienen.
  @Column({
    name: 'card_holder_name',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  cardHolderName!: string | null;

  @Column({ name: 'gateway_reference', type: 'varchar', nullable: true })
  gatewayReference!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar' })
  idempotencyKey!: string;

  @Column({ name: 'shipping_address', type: 'jsonb', nullable: true })
  shippingAddress!: ShippingAddressSnapshot | null;

  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason!: string | null;

  @Column({
    name: 'shipping_status',
    type: 'enum',
    enum: ShippingStatus,
    nullable: true,
  })
  shippingStatus!: ShippingStatus | null;

  @Column({
    name: 'tracking_number',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  trackingNumber!: string | null;

  @Column({ name: 'carrier', type: 'varchar', length: 100, nullable: true })
  carrier!: string | null;

  @Column({
    name: 'shipped_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  shippedAt!: Date | null;

  @Column({
    name: 'delivered_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  deliveredAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @Column({
    name: 'completed_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  completedAt!: Date | null;
}
