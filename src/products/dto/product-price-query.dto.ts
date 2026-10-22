import { Transform, TransformFnParams, Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum ProductSort {
  NEWEST = 'newest',
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
}

// Rango y orden por precio compartidos por GET /products y GET /products/shop.
// El rango se interpreta en la moneda de visualización (X-Display-Currency).
export class ProductPriceQueryDto {
  @ApiPropertyOptional({
    type: Number,
    example: 10,
    description:
      'Precio final mínimo (con descuento), en la moneda de visualización. Acepta 2 decimales',
  })
  @Type(() => Number)
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'priceMin debe ser un número con hasta 2 decimales' },
  )
  @Min(0)
  priceMin?: number;

  @ApiPropertyOptional({
    type: Number,
    example: 100,
    description:
      'Precio final máximo (con descuento), en la moneda de visualización. Acepta 2 decimales',
  })
  @Type(() => Number)
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'priceMax debe ser un número con hasta 2 decimales' },
  )
  @Min(0)
  priceMax?: number;

  @ApiPropertyOptional({
    enum: ProductSort,
    default: ProductSort.NEWEST,
    description:
      'newest (más recientes; recent es sinónimo), price_asc o price_desc (precio final normalizado a USD; empate por id descendente)',
  })
  // recent es sinónimo de newest (lo usa la tienda del vendedor).
  @Transform(({ value }: TransformFnParams) =>
    value === 'recent' ? ProductSort.NEWEST : (value as unknown),
  )
  @IsOptional()
  @IsEnum(ProductSort, {
    message: 'sort debe ser newest, price_asc o price_desc',
  })
  sort: ProductSort = ProductSort.NEWEST;
}
