import { Transform, TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export function parseMultipartArray(value: unknown): unknown {
  if (Array.isArray(value)) return value;

  if (typeof value !== 'string') return value;

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [value];
  } catch {
    return [value];
  }
}

function parseBoolean(value: unknown): unknown {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
}

export function parseInteger(value: unknown): unknown {
  return typeof value === 'string' && value.trim() !== ''
    ? Number(value)
    : value;
}

export function parseIntegerArray(value: unknown): unknown {
  const parsed = parseMultipartArray(value);

  if (!Array.isArray(parsed)) {
    if (typeof parsed !== 'string') return parsed;

    return parsed.split(',').map((item) => parseInteger(item.trim()));
  }

  const parsedItems = parsed as unknown[];

  return parsedItems
    .flatMap((item) =>
      typeof item === 'string' && item.includes(',')
        ? item.split(',').map((part) => part.trim())
        : [item],
    )
    .map(parseInteger);
}

export class CreateCommunityDto {
  @ApiProperty({ example: 'My Little Pony Collectors MX' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'Comunidad para coleccionistas...' })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty({
    example: 'mylittlepony',
    description: 'Identificador único con minúsculas, números y guiones',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'El slug solo puede contener letras minúsculas, números y guiones',
  })
  slug!: string;

  @ApiProperty({ example: false })
  @Transform(({ value }: TransformFnParams) => parseBoolean(value as unknown))
  @IsBoolean({ message: 'isPrivate debe ser un booleano' })
  isPrivate!: boolean;

  @ApiProperty({ example: 1 })
  @Transform(({ value }: TransformFnParams) => parseInteger(value as unknown))
  @IsInt({ message: 'categoryId debe ser un número entero' })
  @Min(1)
  categoryId!: number;

  @ApiProperty({
    type: [Number],
    example: [1, 3],
    minItems: 1,
    maxItems: 3,
    uniqueItems: true,
    description: 'En multipart/form-data puede enviarse como arreglo JSON',
  })
  @Transform(({ value }: TransformFnParams) =>
    parseIntegerArray(value as unknown),
  )
  @IsArray()
  @ArrayMinSize(1, { message: 'Debe proporcionar al menos un tag' })
  @ArrayMaxSize(3, { message: 'No puede proporcionar más de tres tags' })
  @ArrayUnique({ message: 'No puede repetir tags en una comunidad' })
  @IsInt({ each: true, message: 'Cada tagId debe ser un número entero' })
  @Min(1, { each: true })
  tagIds!: number[];

  @ApiProperty({
    type: String,
    example: '["No hacer comentarios ofensivos", "No hacer spam"]',
    description:
      'Acepta un arreglo JSON o partes multipart repetidas. Las comas dentro de cada regla se conservan como parte del texto',
  })
  @Transform(({ value }: TransformFnParams) =>
    parseMultipartArray(value as unknown),
  )
  @IsArray()
  @ArrayUnique({ message: 'No puede repetir reglas en una comunidad' })
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  rules!: string[];
}
