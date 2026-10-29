import { ApiProperty } from '@nestjs/swagger';
import { ShippingStatus } from '../enums/shipping-status.enum';
import { TransactionStatus } from '../enums/transaction-status.enum';

export class PaymentCancelResponseDto {
  @ApiProperty({ format: 'uuid' })
  transactionId!: string;

  @ApiProperty({ enum: TransactionStatus })
  paymentStatus!: TransactionStatus;

  @ApiProperty({ enum: ShippingStatus, nullable: true })
  shippingStatus!: ShippingStatus | null;
}
