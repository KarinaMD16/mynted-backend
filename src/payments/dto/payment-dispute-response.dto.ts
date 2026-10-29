import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentDisputeStatus } from '../enums/payment-dispute-status.enum';
import { ShippingStatus } from '../enums/shipping-status.enum';
import { TransactionStatus } from '../enums/transaction-status.enum';

export class PaymentDisputePartyDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional()
  username?: string;

  @ApiPropertyOptional()
  displayName?: string;
}

export class PaymentDisputeProductDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  title!: string;
}

export class PaymentDisputeItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  transactionId!: string;

  @ApiProperty({ enum: PaymentDisputeStatus })
  status!: PaymentDisputeStatus;

  @ApiProperty()
  reason!: string;

  @ApiPropertyOptional({ nullable: true })
  resolution!: string | null;

  @ApiPropertyOptional({ nullable: true })
  resolutionNote!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional({ nullable: true })
  resolvedAt!: Date | null;

  @ApiProperty({ enum: TransactionStatus })
  paymentStatus!: TransactionStatus;

  @ApiProperty({ enum: ShippingStatus, nullable: true })
  shippingStatus!: ShippingStatus | null;

  @ApiProperty({ type: PaymentDisputePartyDto })
  buyer!: PaymentDisputePartyDto;

  @ApiProperty({ type: PaymentDisputePartyDto })
  seller!: PaymentDisputePartyDto;

  @ApiProperty({ type: PaymentDisputeProductDto })
  product!: PaymentDisputeProductDto;
}

export class PaymentDisputePaginationDto {
  page!: number;
  limit!: number;
  total!: number;
  totalPages!: number;
}

export class PaymentDisputeListResponseDto {
  @ApiProperty({ type: [PaymentDisputeItemDto] })
  data!: PaymentDisputeItemDto[];

  @ApiProperty({ type: PaymentDisputePaginationDto })
  pagination!: PaymentDisputePaginationDto;
}
