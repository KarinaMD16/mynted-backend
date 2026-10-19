import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PaymentHistoryPaginationDto {
  page!: number;
  limit!: number;
  total!: number;
  totalPages!: number;
}

export class PaymentPurchaseProductDto {
  id!: number;
  title!: string;
  imageUrl!: string | null;
}

export class PaymentPurchaseSellerDto {
  sellerId!: number;
  displayName!: string;
}

export class PaymentPurchaseItemDto {
  id!: string;
  product!: PaymentPurchaseProductDto;
  seller!: PaymentPurchaseSellerDto;
  amount!: number;
  currency!: string;
  completedAt!: Date | null;
  cardLast4!: string | null;
  gatewayReference!: string | null;
}

export class PaymentPurchaseListResponseDto {
  @ApiProperty({ type: [PaymentPurchaseItemDto] })
  data!: PaymentPurchaseItemDto[];

  @ApiProperty({ type: PaymentHistoryPaginationDto })
  pagination!: PaymentHistoryPaginationDto;
}

export class PaymentPurchaseItemDocumentationDto {
  @ApiProperty()
  id!: string;
  @ApiProperty({ type: PaymentPurchaseProductDto })
  product!: PaymentPurchaseProductDto;
  @ApiProperty({ type: PaymentPurchaseSellerDto })
  seller!: PaymentPurchaseSellerDto;
  @ApiProperty()
  amount!: number;
  @ApiProperty()
  currency!: string;
  @ApiPropertyOptional()
  completedAt!: Date | null;
  @ApiPropertyOptional()
  cardLast4!: string | null;
  @ApiPropertyOptional()
  gatewayReference!: string | null;
}
