import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';
import { ApiHideProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { parseIntegerArray } from '../../community/dto/create-community.dto';

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

  @ApiPropertyOptional({
    type: [Number],
    example: [1, 3],
    description:
      'Reemplaza por completo los tags del producto. En multipart/form-data puede enviarse como arreglo JSON',
  })
  @Transform(({ value }: TransformFnParams) =>
    parseIntegerArray(value as unknown),
  )
  @IsOptional()
  @IsArray()
  @ArrayUnique({ message: 'No puede repetir tags en el mismo producto' })
  @IsInt({ each: true, message: 'Cada tagId debe ser un número entero' })
  @Min(1, { each: true })
  tagIds?: number[];

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
