import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const trimSearch = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class GetCommunitiesQueryDto {
  @ApiPropertyOptional({
    example: 'dev',
    description: 'Búsqueda parcial y sin distinguir mayúsculas en el nombre',
  })
  @Transform(trimSearch)
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: 2,
    description: 'Filtra por el ID exacto de la categoría',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  categoryId?: number;

  @ApiPropertyOptional({
    example: 'popularity',
    description: 'Orden soportado actualmente',
    enum: ['popularity'],
  })
  @IsOptional()
  @IsIn(['popularity'])
  sort?: 'popularity';

  @ApiPropertyOptional({
    type: Number,
    example: 1,
    default: 1,
    minimum: 1,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({
    type: Number,
    example: 10,
    default: 10,
    minimum: 1,
    maximum: 100,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 10;
}
