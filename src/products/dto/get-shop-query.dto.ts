import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GetShopQueryDto {
  @ApiPropertyOptional({
    type: Number,
    example: 1,
    default: 1,
    minimum: 1,
    description: 'Página de productos dentro de cada sección',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    type: Number,
    example: 4,
    default: 4,
    minimum: 1,
    maximum: 20,
    description: 'Productos por sección',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limit: number = 4;
}
