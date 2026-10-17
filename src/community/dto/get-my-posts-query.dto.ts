import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum SortOrder {
  DESC = 'desc',
  ASC = 'asc',
}

export enum MyPostsSortBy {
  // Votos + frescura (por defecto).
  HOT = 'hot',
  DATE = 'date',
  UPVOTES = 'upvotes',
  DOWNVOTES = 'downvotes',
  SAVES = 'saves',
}

export class GetMyPostsQueryDto {
  @ApiPropertyOptional({
    enum: MyPostsSortBy,
    default: MyPostsSortBy.HOT,
    description:
      'Criterio de orden: hot (votos + frescura), date, upvotes, downvotes o saves',
  })
  @IsOptional()
  @IsEnum(MyPostsSortBy, {
    message: 'sortBy debe ser hot, date, upvotes, downvotes o saves',
  })
  sortBy: MyPostsSortBy = MyPostsSortBy.HOT;

  @ApiPropertyOptional({
    enum: SortOrder,
    default: SortOrder.DESC,
    description:
      'desc = más reciente / con más primero; asc = más antiguo / con menos primero',
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
