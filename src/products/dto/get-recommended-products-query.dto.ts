import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GetRecommendedProductsQueryDto {
  @ApiPropertyOptional({
    type: Number,
    example: 12,
    description:
      'Producto actualmente visible: se usan sus tags y su comunidad como criterio adicional de coincidencia',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  currentProductId?: number;

  @ApiPropertyOptional({
    type: Number,
    example: 4,
    default: 4,
    minimum: 1,
    maximum: 50,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 4;
}
