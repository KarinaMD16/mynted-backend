import { ApiProperty } from '@nestjs/swagger';
import { PaymentHistoryPaginationDto } from './payment-purchase-response.dto';

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
  completedAt!: Date | null;
  product!: PaymentSaleProductDto;
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
