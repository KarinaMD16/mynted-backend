import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransactionStatus } from '../enums/transaction-status.enum';

export class PaymentReceiptProductDto {
  id!: number;
  title!: string;
  imageUrl!: string | null;
}

export class PaymentReceiptSellerDto {
  sellerId!: number;
  displayName!: string;
}

export class PaymentReceiptCommissionDto {
  salesTierName!: string;
  priceTierName!: string;
  commissionRate!: number;
  commissionAmount!: number;
  sellerNet!: number;
}

export class PaymentReceiptResponseDto {
  @ApiProperty()
  id!: string;
  @ApiProperty({ enum: TransactionStatus })
  status!: TransactionStatus;
  @ApiProperty({ type: PaymentReceiptProductDto })
  product!: PaymentReceiptProductDto;
  @ApiProperty({ type: PaymentReceiptSellerDto })
  seller!: PaymentReceiptSellerDto;
  @ApiProperty()
  amount!: number;
  @ApiProperty()
  currency!: string;
  @ApiProperty()
  date!: Date;
  @ApiPropertyOptional()
  cardLast4!: string | null;
  @ApiPropertyOptional()
  gatewayReference!: string | null;
  @ApiPropertyOptional()
  failureReason!: string | null;
  @ApiPropertyOptional({ type: PaymentReceiptCommissionDto })
  commission?: PaymentReceiptCommissionDto;
}
