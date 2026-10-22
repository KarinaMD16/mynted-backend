import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProductPriceQueryDto } from '../../products/dto/product-price-query.dto';
import {
  ProductCondition,
  ProductStatus,
  ProductType,
} from '../../products/entities/product.entity';
import { PublicProductStatus } from '../../products/products.service';

const PUBLIC_STATUSES: PublicProductStatus[] = [
  ProductStatus.ACTIVE,
  ProductStatus.SOLD,
];

// sort (recent|newest|price_asc|price_desc), priceMin y priceMax vienen de
// ProductPriceQueryDto, igual que en GET /products.
export class GetSellerProductsQueryDto extends ProductPriceQueryDto {
  @ApiPropertyOptional({
    type: Number,
    example: 2,
    description: 'Filtra por tag (id)',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  tag?: number;

  @ApiPropertyOptional({ enum: ProductType, example: ProductType.SALE })
  @IsOptional()
  @IsEnum(ProductType, { message: 'type debe ser sale o exchange' })
  type?: ProductType;

  @ApiPropertyOptional({
    enum: ProductCondition,
    example: ProductCondition.NEW,
  })
  @IsOptional()
  @IsEnum(ProductCondition, {
    message:
      'condition debe ser new, like_new, good_condition o used_with_details',
  })
  condition?: ProductCondition;

  @ApiPropertyOptional({
    enum: PUBLIC_STATUSES,
    default: ProductStatus.ACTIVE,
    description:
      'active (por defecto) o sold. draft e inactive nunca son públicos',
  })
  @IsOptional()
  @IsIn(PUBLIC_STATUSES, { message: 'status debe ser active o sold' })
  status: PublicProductStatus = ProductStatus.ACTIVE;

  @ApiPropertyOptional({ type: Number, example: 1, default: 1, minimum: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    type: Number,
    example: 10,
    default: 10,
    minimum: 1,
    maximum: 100,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}
