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
  cardHolderName!: string | null;
  gatewayReference!: string | null;

  @ApiProperty({
    example: false,
    description:
      'true si el vendedor borró el producto (soft delete). El detalle del producto da 404: no lo enlaces. La compra, el comprobante y la reseña siguen disponibles',
  })
  productDeleted!: boolean;

  @ApiProperty({
    example: true,
    description:
      'true si el usuario puede reseñar este producto ahora (compra completada, sin reseña propia, no es el vendedor ni un producto de intercambio)',
  })
  canReview!: boolean;

  @ApiProperty({ example: false, description: 'Ya reseñó este producto' })
  hasReviewed!: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: null,
    description: 'Id de su reseña del producto (para "editar tu reseña")',
  })
  reviewId!: number | null;
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
  cardHolderName!: string | null;
  @ApiPropertyOptional()
  gatewayReference!: string | null;
}
