import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { parseIntegerArray } from './create-community.dto';

export class GetGlobalPostsQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @ApiPropertyOptional({
    type: String,
    description: 'Busca parcialmente en el título y cuerpo del post.',
    example: 'pokemon',
  })
  @Transform(({ value }: TransformFnParams) => {
    const input: unknown = value;
    if (typeof input !== 'string') return input;
    const trimmed = input.trim();
    return trimmed === '' ? undefined : trimmed;
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    type: [Number],
    description: 'Tags opcionales. Se aplica lógica OR.',
    example: [1, 3, 5],
  })
  @Transform(({ value }: TransformFnParams) => {
    const input: unknown = value;
    if (input === undefined || input === '' || input === null) return undefined;
    return parseIntegerArray(input);
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique({ message: 'No puede repetir tags en el filtro' })
  @IsInt({ each: true, message: 'Cada tagId debe ser un número entero' })
  @Min(1, { each: true })
  tagIds?: number[];
}
