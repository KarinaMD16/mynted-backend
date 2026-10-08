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
import { ApiHideProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  parseBoolean,
  parseCodeArray,
  parseInteger,
  parseIntegerArray,
} from '../../community/dto/create-community.dto';
import { ProductCondition, ProductType } from '../entities/product.entity';
import {
  MAX_RELATED_PRODUCTS,
  REQUIRED_PRODUCT_TAG_COUNT,
} from './create-product.dto';

export class UpdateProductDto {
  @ApiPropertyOptional({ example: 'Figura de Charizard Funko Pop #123' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiPropertyOptional({ example: 'Figura original, caja sellada, sin abrir' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @ApiPropertyOptional({ example: 22.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  price?: number;

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
    type: [Number],
    example: [1, 3, 5],
    maxItems: REQUIRED_PRODUCT_TAG_COUNT,
    description:
      'Reemplaza por completo los tags del producto. En un producto publicado debe traer exactamente 3; en un borrador, hasta 3. En multipart/form-data puede enviarse como arreglo JSON',
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
    nullable: true,
    example: 5,
    description:
      'Mueve el producto a esta comunidad (debes ser miembro). "null" lo deja sin comunidad. Si se omite, no cambia',
  })
  @Transform(({ value }: TransformFnParams) =>
    value === 'null' || value === '' ? null : parseInteger(value as unknown),
  )
  @IsOptional()
  @IsInt()
  @Min(1)
  communityId?: number | null;

  @ApiPropertyOptional({
    type: Number,
    example: 15,
    minimum: 0,
    maximum: 100,
    description:
      'Porcentaje de descuento (0 lo quita). price no se modifica: la respuesta trae finalPrice',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @ApiPropertyOptional({
    example: true,
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
      'Reemplaza los países de envío (ISO 3166-1 alfa-2). Acepta arreglo JSON, partes repetidas o lista separada por comas',
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
    description: `Reemplaza los productos relacionados (máximo ${MAX_RELATED_PRODUCTS}; del mismo vendedor y activos). [] los quita`,
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
