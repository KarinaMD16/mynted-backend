import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum FavoriteIdsType {
  PRODUCTS = 'products',
  POSTS = 'posts',
}

export class GetFavoriteIdsQueryDto {
  @ApiPropertyOptional({
    enum: FavoriteIdsType,
    default: FavoriteIdsType.PRODUCTS,
    description: 'Qué ids guardados devolver: products o posts',
  })
  @IsOptional()
  @IsEnum(FavoriteIdsType, { message: 'type debe ser products o posts' })
  type: FavoriteIdsType = FavoriteIdsType.PRODUCTS;
}
