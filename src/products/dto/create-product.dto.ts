import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO31661Alpha2,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  parseBoolean,
  parseCodeArray,
  parseIntegerArray,
} from '../../community/dto/create-community.dto';
import { ProductCondition, ProductType } from '../entities/product.entity';

export const REQUIRED_PRODUCT_TAG_COUNT = 3;
export const MAX_RELATED_PRODUCTS = 6;

/**
 * Para publicar (saveAsDraft = false, el valor por defecto) el servicio exige
 * description, price, type, condition, exactamente 3 tags y la imagen de
 * portada. Un borrador solo requiere title; el resto es opcional y se valida
 * por completo al publicar.
 */
export class CreateProductDto {
  @ApiProperty({ example: 'Figura de Charizard Funko Pop #123' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({
    example: 'Figura original, caja sellada, sin abrir',
    description: 'Obligatorio al publicar',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @ApiPropertyOptional({
    example: 25.99,
    description: 'Obligatorio al publicar',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  price?: number;

  @ApiPropertyOptional({
    enum: ProductType,
    example: ProductType.SALE,
    description: 'Obligatorio al publicar',
  })
  @IsOptional()
  @IsEnum(ProductType, { message: 'type debe ser sale o exchange' })
  type?: ProductType;

  @ApiPropertyOptional({
    enum: ProductCondition,
    example: ProductCondition.NEW,
    description: 'Obligatorio al publicar',
  })
  @IsOptional()
  @IsEnum(ProductCondition, {
    message:
      'condition debe ser new, like_new, good_condition o used_with_details',
  })
  condition?: ProductCondition;

  @ApiPropertyOptional({
    type: [Number],
    example: [1, 3, 5],
    maxItems: REQUIRED_PRODUCT_TAG_COUNT,
    description:
      'Al publicar debe traer exactamente 3 tags; un borrador puede traer hasta 3. En multipart/form-data puede enviarse como arreglo JSON',
  })
  @Transform(({ value }: TransformFnParams) =>
    parseIntegerArray(value as unknown),
  )
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(REQUIRED_PRODUCT_TAG_COUNT, {
    message: `No puede seleccionar más de ${REQUIRED_PRODUCT_TAG_COUNT} tags`,
  })
  @ArrayUnique({ message: 'No puede repetir tags en el mismo producto' })
  @IsInt({ each: true, message: 'Cada tagId debe ser un número entero' })
  @Min(1, { each: true })
  tagIds?: number[];

  @ApiPropertyOptional({
    type: Number,
    example: 15,
    minimum: 0,
    maximum: 100,
    description:
      'Porcentaje de descuento. price no se modifica: la respuesta trae finalPrice',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @ApiPropertyOptional({
    example: true,
    default: true,
    description: 'Si es false, el producto no aparece en listados públicos',
  })
  @IsOptional()
  @Transform(({ value }: TransformFnParams) => parseBoolean(value as unknown))
  @IsBoolean({ message: 'isVisible debe ser un booleano' })
  isVisible?: boolean;

  @ApiPropertyOptional({
    type: [String],
    example: ['CR', 'MX'],
    description:
      'Países a los que envía (ISO 3166-1 alfa-2). Acepta arreglo JSON, partes repetidas o lista separada por comas',
  })
  @Transform(({ value }: TransformFnParams) => parseCodeArray(value as unknown))
  @IsOptional()
  @IsArray()
  @ArrayUnique({ message: 'No puede repetir países' })
  @IsISO31661Alpha2({
    each: true,
    message: 'Cada país debe ser un código ISO 3166-1 alfa-2 (p. ej. CR)',
  })
  shipsTo?: string[];

  @ApiPropertyOptional({
    type: [Number],
    example: [10, 11],
    maxItems: MAX_RELATED_PRODUCTS,
    description: `Productos relacionados elegidos por el vendedor (máximo ${MAX_RELATED_PRODUCTS}; del mismo vendedor y activos)`,
  })
  @Transform(({ value }: TransformFnParams) =>
    parseIntegerArray(value as unknown),
  )
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RELATED_PRODUCTS, {
    message: `No puede elegir más de ${MAX_RELATED_PRODUCTS} productos relacionados`,
  })
  @ArrayUnique({ message: 'No puede repetir productos relacionados' })
  @IsInt({ each: true })
  @Min(1, { each: true })
  relatedProductIds?: number[];

  @ApiPropertyOptional({
    example: false,
    default: false,
    description:
      'true guarda el producto como borrador (no se publica ni se valida por completo)',
  })
  @IsOptional()
  @Transform(({ value }: TransformFnParams) => parseBoolean(value as unknown))
  @IsBoolean({ message: 'saveAsDraft debe ser un booleano' })
  saveAsDraft?: boolean;

  // No se validan aquí: los archivos reales llegan por @UploadedFiles(), no
  // por el body. Existen solo para que el ValidationPipe global
  // (forbidNonWhitelisted) no rechace estos campos del multipart — algunos
  // clientes (p. ej. Swagger UI) mandan un valor de texto placeholder para
  // un campo de archivo array que no fue completado.
  @ApiHideProperty()
  @IsOptional()
  image?: unknown;

  @ApiHideProperty()
  @IsOptional()
  images?: unknown;
}
