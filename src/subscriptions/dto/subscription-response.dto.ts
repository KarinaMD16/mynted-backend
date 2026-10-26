import { ApiProperty } from '@nestjs/swagger';
import { SubscriptionPeriod } from '../subscription-period.enum';
import { SubscriptionStatus } from '../subscription-dates';
import { SubscriptionPaymentStatus } from '../entities/subscription-payment.entity';

export class SubscriptionPlanDto {
  @ApiProperty({ enum: SubscriptionPeriod })
  period!: SubscriptionPeriod;

  @ApiProperty({ example: 6, description: 'Meses de calendario que cubre' })
  months!: number;

  @ApiProperty({ example: 24.99, description: 'Lo que se cobra, en USD' })
  amount!: number;

  @ApiProperty({
    example: 'USD',
    description: 'Moneda del cobro (siempre USD)',
  })
  currency!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 12495,
    description:
      'Precio en la moneda de visualización del usuario (informativo). null si no hay tipo de cambio: muestra amount en USD',
  })
  displayAmount!: number | null;

  @ApiProperty({ example: 'CRC' })
  displayCurrency!: string;

  @ApiProperty({
    example: 17,
    description: 'Ahorro en % frente a pagar el plan mensual esos mismos meses',
  })
  savingsPercent!: number;
}

export class SubscriptionPlansResponseDto {
  @ApiProperty({ example: 'pro' })
  plan!: string;

  @ApiProperty({ type: [SubscriptionPlanDto] })
  plans!: SubscriptionPlanDto[];
}

export class MySubscriptionDto {
  @ApiProperty({ example: true, description: 'ends_at > ahora' })
  isPro!: boolean;

  @ApiProperty({
    enum: ['none', 'active', 'cancelled', 'expired'],
    description:
      'none: nunca ha sido Pro. active: vigente. cancelled: vigente pero canceló (sigue siendo Pro hasta endsAt). expired: venció',
  })
  status!: SubscriptionStatus;

  @ApiProperty({ enum: SubscriptionPeriod, nullable: true })
  period!: SubscriptionPeriod | null;

  @ApiProperty({ type: Date, nullable: true })
  startsAt!: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  endsAt!: Date | null;

  @ApiProperty({ example: false })
  cancelAtPeriodEnd!: boolean;

  @ApiProperty({ example: 31, description: '0 si no está vigente' })
  daysRemaining!: number;
}

export class SubscriptionPaymentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: SubscriptionPaymentStatus })
  status!: SubscriptionPaymentStatus;

  @ApiProperty({ enum: SubscriptionPeriod })
  period!: SubscriptionPeriod;

  @ApiProperty({ example: 41.99 })
  amount!: number;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ type: Number, nullable: true })
  displayAmount!: number | null;

  @ApiProperty({ type: String, nullable: true })
  displayCurrency!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  exchangeRate!: number | null;

  @ApiProperty({ type: String, nullable: true, example: 'SIM-1A2B3C' })
  gatewayReference!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'visa' })
  cardBrand!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '4242' })
  cardLast4!: string | null;

  @ApiProperty({ type: String, nullable: true })
  cardHolderName!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'card_declined',
    description: 'Solo en pagos rechazados',
  })
  failureReason!: string | null;

  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'Desde cuándo cubre este pago (solo si fue aprobado)',
  })
  coversFrom!: Date | null;

  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'Hasta cuándo cubre este pago (solo si fue aprobado)',
  })
  coversUntil!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}

export class SubscriptionPaymentListResponseDto {
  @ApiProperty({ type: [SubscriptionPaymentDto] })
  data!: SubscriptionPaymentDto[];

  @ApiProperty({
    example: { page: 1, limit: 10, total: 3, totalPages: 1 },
  })
  pagination!: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
