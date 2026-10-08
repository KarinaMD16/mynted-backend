import { Transform, TransformFnParams, Type } from 'class-transformer';
import { IsInt, IsISO31661Alpha2, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GetShopQueryDto {
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
    example: 4,
    default: 4,
    minimum: 1,
    maximum: 20,
    description: 'Productos por sección',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  productsLimit: number = 4;

  @ApiPropertyOptional({
    example: 'CR',
    description: 'Solo productos que envían a este país (ISO 3166-1 alfa-2)',
  })
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim().toUpperCase() : (value as unknown),
  )
  @IsOptional()
  @IsISO31661Alpha2({ message: 'shipTo debe ser un código ISO 3166-1 alfa-2' })
  shipTo?: string;
}
