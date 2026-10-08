import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ProductCondition,
  ProductStatus,
  ProductType,
} from '../entities/product.entity';

export class GetMyProductsQueryDto {
  @ApiPropertyOptional({
    example: 'pikachu',
    description:
      'Busca entre mis productos por título (contiene, sin distinguir mayúsculas)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    example: 'pikachu',
    deprecated: true,
    description: 'Alias antiguo de q',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional({
    type: Number,
    example: 2,
    description:
      'Devuelve solo la sección de este tag, paginada con productsPage/productsLimit',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  tagId?: number;

  @ApiPropertyOptional({
    enum: ProductStatus,
    example: ProductStatus.ACTIVE,
    description:
      'draft, active, sold o inactive (pausado). Si se omite, trae productos de cualquier estado, borradores incluidos',
  })
  @IsOptional()
  @IsEnum(ProductStatus, {
    message: 'status debe ser draft, active, sold o inactive',
  })
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
    description: 'Página de secciones (tags) para el scroll infinito',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    type: Number,
    example: 3,
    default: 3,
    minimum: 1,
    maximum: 20,
    description: 'Secciones (tags) por página',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limit: number = 3;

  @ApiPropertyOptional({
    type: Number,
    example: 1,
    default: 1,
    minimum: 1,
    description: 'Página de productos dentro de cada sección',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  productsPage: number = 1;

  @ApiPropertyOptional({
    type: Number,
    example: 8,
    default: 8,
    minimum: 1,
    maximum: 50,
    description: 'Productos por sección',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  productsLimit: number = 8;
}
