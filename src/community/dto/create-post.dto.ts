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

  @ApiProperty({
    type: [Number],
    example: [1, 3],
    description:
      'Entre 1 y 3 tags. Puede enviarse como arreglo JSON en multipart.',
  })
  @Transform(({ value }: TransformFnParams) => {
    const input: unknown = value;
    if (input === undefined || Array.isArray(input)) return input;

    if (typeof input === 'string' && input.trim().startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(input);
        return parsed;
      } catch {
        return input;
      }
    }

    return parseIntegerArray(input);
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'La publicación debe tener al menos un tag' })
  @ArrayMaxSize(3, { message: 'La publicación no puede tener más de 3 tags' })
  @ArrayUnique({ message: 'No puede repetir tags en la publicación' })
  @IsInt({ each: true, message: 'Cada tagId debe ser un número entero' })
  @Min(1, { each: true })
  tagIds!: number[];

  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'string', format: 'binary' },
    maxItems: 10,
    description: 'Imágenes opcionales de la publicación (máximo 10).',
  })
  @IsOptional()
  images?: unknown;
}
