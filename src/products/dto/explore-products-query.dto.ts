import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExploreProductsQueryDto {
  @ApiProperty({
    type: Number,
    example: 2,
    description:
      'ID del tag. Lista productos de todas las comunidades que lo usan',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tagId!: number;

  @ApiPropertyOptional({ type: Number, example: 1, default: 1, minimum: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

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
  limit: number = 10;
}
