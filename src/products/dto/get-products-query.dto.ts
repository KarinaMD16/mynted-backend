import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProductCondition, ProductType } from '../entities/product.entity';

export class GetProductsQueryDto {
  @ApiPropertyOptional({
    type: Number,
    example: 5,
    description: 'Filtra por comunidad',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  communityId?: number;

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

  @ApiPropertyOptional({
    type: Number,
    example: 1,
    description:
      'Filtra por la categoría de la comunidad a la que pertenece el producto',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  category?: number;

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
