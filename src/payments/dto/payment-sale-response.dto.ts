import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentHistoryPaginationDto } from './payment-purchase-response.dto';
import { ShippingStatus } from '../enums/shipping-status.enum';
import { TransactionStatus } from '../enums/transaction-status.enum';

export class PaymentSaleProductDto {
  id!: number;
  title!: string;
  imageUrl!: string | null;
}

export class PaymentSaleBuyerDto {
  id!: string;
  username!: string;
  photoUrl!: string | null;
}

export class PaymentSaleItemDto {
  id!: string;
  @ApiProperty({ enum: TransactionStatus })
  paymentStatus!: TransactionStatus;
  completedAt!: Date | null;
  @ApiPropertyOptional({ enum: ShippingStatus, nullable: true })
  shippingStatus!: ShippingStatus | null;
  product!: PaymentSaleProductDto;

  @ApiProperty({
    example: false,
    description:
      'true si el vendedor borró el producto (soft delete). La venta sigue en el historial, pero el detalle del producto da 404: no lo enlaces',
  })
  productDeleted!: boolean;

  buyer!: PaymentSaleBuyerDto;
  amount!: number;
  currency!: string;
  salesTierName!: string;
  priceTierName!: string;
  commissionRate!: number;
  commissionAmount!: number;
  sellerNet!: number;
}

export class PaymentSaleListResponseDto {
  @ApiProperty({ type: [PaymentSaleItemDto] })
  data!: PaymentSaleItemDto[];

  @ApiProperty({ type: PaymentHistoryPaginationDto })
  pagination!: PaymentHistoryPaginationDto;
}
