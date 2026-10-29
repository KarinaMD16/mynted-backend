import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShippingStatus } from '../enums/shipping-status.enum';

export class PaymentShippingResponseDto {
  @ApiProperty({ format: 'uuid' })
  transactionId!: string;

  @ApiProperty()
  paymentStatus!: string;

  @ApiPropertyOptional({ enum: ShippingStatus, nullable: true })
  shippingStatus!: ShippingStatus | null;

  @ApiPropertyOptional({ nullable: true })
  trackingNumber!: string | null;

  @ApiPropertyOptional({ nullable: true })
  carrier!: string | null;

  @ApiPropertyOptional({ nullable: true })
  shippedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  deliveredAt!: Date | null;
}
