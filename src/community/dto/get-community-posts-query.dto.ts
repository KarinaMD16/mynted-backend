import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PostSort } from '../post-ranking';
import { GetPostsQueryDto } from './get-posts-query.dto';

export class GetCommunityPostsQueryDto extends GetPostsQueryDto {
  @ApiPropertyOptional({
    enum: PostSort,
    default: PostSort.HOT,
    description:
      'hot (por defecto): upvotes/downvotes y frescura; new: más recientes; top: más votos netos',
  })
  @IsOptional()
  @IsEnum(PostSort, { message: 'sort debe ser hot, new o top' })
  sort?: PostSort = PostSort.HOT;
}
