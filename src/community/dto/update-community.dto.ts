import { Transform, TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  parseInteger,
  parseIntegerArray,
  parseMultipartArray,
} from './create-community.dto';

export class UpdateCommunityDto {
  @ApiPropertyOptional({ example: 'Nuevo nombre de la comunidad' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ example: 'Nueva descripción de la comunidad' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @ApiPropertyOptional({ example: 2, minimum: 1 })
  @Transform(({ value }: TransformFnParams) => parseInteger(value as unknown))
  @IsOptional()
  @IsInt({ message: 'categoryId debe ser un número entero' })
  @Min(1)
  categoryId?: number;

  @ApiPropertyOptional({
    type: [Number],
    example: [1, 3],
    minItems: 1,
    maxItems: 3,
    uniqueItems: true,
  })
  @Transform(({ value }: TransformFnParams) =>
    parseIntegerArray(value as unknown),
  )
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Debe proporcionar al menos un tag' })
  @ArrayMaxSize(3, { message: 'No puede proporcionar más de tres tags' })
  @ArrayUnique({ message: 'No puede repetir tags en una comunidad' })
  @IsInt({ each: true, message: 'Cada tagId debe ser un número entero' })
  @Min(1, { each: true })
  tagIds?: number[];

  @ApiPropertyOptional({
    type: [String],
    example: ['No hacer spam', 'Mantener el respeto'],
    description:
      'Acepta un arreglo JSON o partes multipart repetidas. Las comas dentro de cada regla se conservan',
  })
  @Transform(({ value }: TransformFnParams) =>
    parseMultipartArray(value as unknown),
  )
  @IsOptional()
  @IsArray()
  @ArrayUnique({ message: 'No puede repetir reglas en una comunidad' })
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  rules?: string[];
}
