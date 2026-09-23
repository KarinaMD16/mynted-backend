import { Transform, TransformFnParams, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { parseBoolean, parseInteger } from './create-community.dto';

export class GetTagsQueryDto {
  @ApiPropertyOptional({
    example: 1,
    default: 1,
    minimum: 1,
    description: 'Número de página',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    example: 10,
    default: 10,
    minimum: 1,
    maximum: 100,
    description: 'Cantidad de tags por página',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;

  @ApiPropertyOptional({
    example: true,
    description:
      'Filtra por tags principales (true, para el picker de onboarding) o hiper específicos (false)',
  })
  @Transform(({ value }: TransformFnParams) => parseBoolean(value as unknown))
  @IsOptional()
  @IsBoolean()
  isInterest?: boolean;

  @ApiPropertyOptional({
    example: 1,
    description: 'Filtra por categoría',
  })
  @Transform(({ value }: TransformFnParams) => parseInteger(value as unknown))
  @IsOptional()
  @IsInt()
  @Min(1)
  categoryId?: number;
}
