import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Un comentario vacío o de solo espacios se guarda como null; null (o
// undefined) se respeta tal cual.
const trimToNull = ({ value }: TransformFnParams): unknown => {
  if (typeof value !== 'string') return value as unknown;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export class CreateReviewDto {
  @ApiProperty({ type: Number, minimum: 1, maximum: 5, example: 5 })
  @Type(() => Number)
  @IsInt({ message: 'rating debe ser un entero entre 1 y 5' })
  @Min(1, { message: 'rating debe ser un entero entre 1 y 5' })
  @Max(5, { message: 'rating debe ser un entero entre 1 y 5' })
  rating!: number;

  @ApiPropertyOptional({
    example: 'Llegó en perfecto estado, muy buen vendedor',
    maxLength: 1000,
    nullable: true,
    description: 'Opcional. Vacío o solo espacios se guarda como null',
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string | null;
}

export class UpdateReviewDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 5, example: 4 })
  @Type(() => Number)
  @IsOptional()
  @IsInt({ message: 'rating debe ser un entero entre 1 y 5' })
  @Min(1, { message: 'rating debe ser un entero entre 1 y 5' })
  @Max(5, { message: 'rating debe ser un entero entre 1 y 5' })
  rating?: number;

  @ApiPropertyOptional({
    example: 'Actualicé mi opinión',
    maxLength: 1000,
    nullable: true,
    description:
      'null (o vacío / solo espacios) borra el comentario; si se omite no cambia',
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string | null;
}

export class GetReviewsQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ type: Number, default: 10, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}
