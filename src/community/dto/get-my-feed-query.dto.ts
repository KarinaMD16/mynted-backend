import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SortOrder } from './get-my-posts-query.dto';

export class GetMyFeedQueryDto {
  @ApiPropertyOptional({
    enum: SortOrder,
    default: SortOrder.DESC,
    description: 'desc = más reciente primero; asc = más antiguo primero',
  })
  @IsOptional()
  @IsEnum(SortOrder, { message: 'order debe ser asc o desc' })
  order: SortOrder = SortOrder.DESC;

  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}
