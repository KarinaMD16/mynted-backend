import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { parseIntegerArray } from '../../community/dto/create-community.dto';

export class GetRecommendedProductsQueryDto {
  @ApiPropertyOptional({
    type: Number,
    example: 12,
    description:
      'Producto actualmente visible: se usan sus tags y su comunidad como criterio adicional de coincidencia',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  currentProductId?: number;

  @ApiPropertyOptional({
    type: [Number],
    example: [12, 15, 20],
    maxItems: 10,
    description:
      'Ids de productos vistos recientemente (máx. 10), que el frontend saca de una cookie. Se usan sus tags cuando no hay sesión; con sesión se usan los últimos 10 vistos guardados en el servidor. Acepta lista separada por comas o parámetros repetidos',
  })
  @Transform(({ value }: TransformFnParams) =>
    parseIntegerArray(value as unknown),
  )
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'recentProductIds admite como máximo 10 ids' })
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  recentProductIds?: number[];

  @ApiPropertyOptional({
    type: Number,
    example: 4,
    default: 4,
    minimum: 1,
    maximum: 50,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 4;
}
