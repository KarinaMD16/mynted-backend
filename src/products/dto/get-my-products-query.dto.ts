import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ProductCondition,
  ProductStatus,
  ProductType,
} from '../entities/product.entity';

export class GetMyProductsQueryDto {
  @ApiPropertyOptional({
    enum: ProductStatus,
    example: ProductStatus.ACTIVE,
    description: 'Si se omite, trae productos de cualquier estado',
  })
  @IsOptional()
  @IsEnum(ProductStatus, { message: 'status debe ser active, sold o inactive' })
  status?: ProductStatus;

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

  @ApiPropertyOptional({ type: Number, example: 10 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  priceMin?: number;

  @ApiPropertyOptional({ type: Number, example: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  priceMax?: number;

  @ApiPropertyOptional({
    type: Number,
    example: 1,
    default: 1,
    minimum: 1,
    description: 'Página de productos dentro de cada sección (tag)',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    type: Number,
    example: 8,
    default: 8,
    minimum: 1,
    maximum: 50,
    description: 'Productos por sección (tag)',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 8;
}
