import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { GetMyFeedQueryDto } from './get-my-feed-query.dto';

export enum ContentType {
  ALL = 'all',
  POSTS = 'posts',
  PRODUCTS = 'products',
}

export class GetMyContentQueryDto extends GetMyFeedQueryDto {
  @ApiPropertyOptional({
    enum: ContentType,
    default: ContentType.ALL,
    description:
      'Pestañas: todo, solo publicaciones (posts) o solo tienda (products)',
  })
  @IsOptional()
  @IsEnum(ContentType, { message: 'type debe ser all, posts o products' })
  type: ContentType = ContentType.ALL;
}
