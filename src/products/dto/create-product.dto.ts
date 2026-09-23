import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { parseIntegerArray } from '../../community/dto/create-community.dto';
import { ProductCondition, ProductType } from '../entities/product.entity';

const REQUIRED_PRODUCT_TAG_COUNT = 3;

export class CreateProductDto {
  @ApiProperty({ example: 'Figura de Charizard Funko Pop #123' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({ example: 'Figura original, caja sellada, sin abrir' })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty({ example: 25.99 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  price!: number;

  @ApiProperty({ enum: ProductType, example: ProductType.SALE })
  @IsEnum(ProductType, { message: 'type debe ser sale o exchange' })
  type!: ProductType;

  @ApiProperty({
    enum: ProductCondition,
    example: ProductCondition.NEW,
  })
  @IsEnum(ProductCondition, {
    message:
      'condition debe ser new, like_new, good_condition o used_with_details',
  })
  condition!: ProductCondition;

  @ApiProperty({
    type: [Number],
    example: [1, 3, 5],
    minItems: REQUIRED_PRODUCT_TAG_COUNT,
    maxItems: REQUIRED_PRODUCT_TAG_COUNT,
    description:
      'Debe traer exactamente 3 tags. En multipart/form-data puede enviarse como arreglo JSON',
  })
  @Transform(({ value }: TransformFnParams) =>
    parseIntegerArray(value as unknown),
  )
  @IsArray()
  @ArrayMinSize(REQUIRED_PRODUCT_TAG_COUNT, {
    message: `Debe seleccionar exactamente ${REQUIRED_PRODUCT_TAG_COUNT} tags`,
  })
  @ArrayMaxSize(REQUIRED_PRODUCT_TAG_COUNT, {
    message: `Debe seleccionar exactamente ${REQUIRED_PRODUCT_TAG_COUNT} tags`,
  })
  @ArrayUnique({ message: 'No puede repetir tags en el mismo producto' })
  @IsInt({ each: true, message: 'Cada tagId debe ser un número entero' })
  @Min(1, { each: true })
  tagIds!: number[];

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
