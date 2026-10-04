import { Transform, TransformFnParams } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { parseIntegerArray } from './create-community.dto';

export class CreatePostDto {
  @ApiProperty({ example: 'Mi nueva colección' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 200)
  title!: string;

  @ApiProperty({ example: 'Comparto algunas piezas de mi colección.' })
  @IsString()
  @IsNotEmpty()
  body!: string;

  @ApiPropertyOptional({
    type: [Number],
    example: [1, 3],
    description: 'Opcional. Puede enviarse como arreglo JSON en multipart.',
  })
  @Transform(({ value }: TransformFnParams) => {
    const input: unknown = value;
    return input === undefined ? undefined : parseIntegerArray(input);
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique({ message: 'No puede repetir tags en la publicación' })
  @IsInt({ each: true, message: 'Cada tagId debe ser un número entero' })
  @Min(1, { each: true })
  tagIds?: number[];

  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'string', format: 'binary' },
    maxItems: 10,
    description: 'Imágenes opcionales de la publicación (máximo 10).',
  })
  @IsOptional()
  images?: unknown;
}
