import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { CommunityProfileRole } from './entities/community-profile.entity';
import { CommunityRoleGuard } from './guards/community-role.guard';
import { RequireCommunityRole } from './decorators/require-community-role.decorator';
import { CreatePostDto } from './dto/create-post.dto';
import { CreateReplyDto } from './dto/create-reply.dto';
import { GetPostsQueryDto } from './dto/get-posts-query.dto';
import { GetGlobalPostsQueryDto } from './dto/get-global-posts-query.dto';
import { GetMyPostsQueryDto } from './dto/get-my-posts-query.dto';
import { GetFavoriteIdsQueryDto } from './dto/get-favorite-ids-query.dto';
import { GetMyFeedQueryDto } from './dto/get-my-feed-query.dto';
import { GetMyContentQueryDto } from './dto/get-my-content-query.dto';
import { VoteDto } from './dto/vote.dto';
import { FavoriteItemType } from './entities/favorite.entity';
import { ForumService } from './forum.service';

interface ForumFiles {
  images?: Express.Multer.File[];
}

@ApiTags('forum')
@ApiBearerAuth()
@Controller()
export class ForumController {
  constructor(private readonly forumService: ForumService) {}

  @Post('communities/:communityId/posts')
  @UseGuards(JwtAuthGuard, CommunityRoleGuard)
  @RequireCommunityRole(
    CommunityProfileRole.MEMBER,
    CommunityProfileRole.MODERATOR,
    CommunityProfileRole.OWNER,
  )
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'images', maxCount: 10 }], {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  createPost(
    @Param('communityId', ParseIntPipe) communityId: number,
    @Body() dto: CreatePostDto,
    @UploadedFiles() files: ForumFiles,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.createPost(
      communityId,
      request.user.userId,
      dto,
      files,
    );
  }

  @Get('communities/:communityId/posts')
  @UseGuards(JwtAuthGuard)
  findPosts(
    @Param('communityId', ParseIntPipe) communityId: number,
    @Query() query: GetPostsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.findPosts(communityId, request.user.userId, query);
  }

  @Get('posts')
  @UseGuards(JwtAuthGuard)
  findGlobalPosts(
    @Query() query: GetGlobalPostsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.findGlobalPosts(request.user.userId, query);
  }

  @Get('forums/me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Posts del foro publicados por el usuario autenticado, paginados y ordenables por fecha, upvotes, downvotes o guardados',
  })
  findMyPosts(
    @Query() query: GetMyPostsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.findMyPosts(request.user.userId, query);
  }

  @Get('posts/me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Posts y productos publicados por el usuario autenticado, mezclados por fecha (el tab Todo). Para solo posts o solo productos usar /forums/me y /products/me',
  })
  findMyContent(
    @Query() query: GetMyFeedQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.findMyContent(request.user.userId, query);
  }

  @Get('favorites/me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Posts y productos guardados como favoritos por el usuario autenticado, del más recientemente guardado al más antiguo. type: all | posts | products',
  })
  findMyFavorites(
    @Query() query: GetMyContentQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.findMyFavorites(request.user.userId, query);
  }

  @Get('favorites/me/ids')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Solo los ids de los productos (type=products) o posts (type=posts) guardados como favoritos',
  })
  findMyFavoriteIds(
    @Query() query: GetFavoriteIdsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.findMyFavoriteIds(request.user.userId, query);
  }

  @Get('posts/:postId')
  @UseGuards(JwtAuthGuard)
  findPost(
    @Param('postId', ParseIntPipe) postId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.findPost(postId, request.user.userId);
  }

  @Post('posts/:postId/replies')
  @UseGuards(JwtAuthGuard)
  createReply(
    @Param('postId', ParseIntPipe) postId: number,
    @Body() dto: CreateReplyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.createReply(postId, request.user.userId, dto);
  }

  @Get('posts/:postId/replies')
  @UseGuards(JwtAuthGuard)
  findReplies(
    @Param('postId', ParseIntPipe) postId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.findReplies(postId, request.user.userId);
  }

  @Put('posts/:postId/vote')
  @UseGuards(JwtAuthGuard)
  votePost(
    @Param('postId', ParseIntPipe) postId: number,
    @Body() dto: VoteDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.votePost(postId, request.user.userId, dto);
  }

  @Put('replies/:replyId/vote')
  @UseGuards(JwtAuthGuard)
  voteReply(
    @Param('replyId', ParseIntPipe) replyId: number,
    @Body() dto: VoteDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.voteReply(replyId, request.user.userId, dto);
  }

  @Put('posts/:postId/favorite')
  @UseGuards(JwtAuthGuard)
  savePost(
    @Param('postId', ParseIntPipe) postId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.saveFavorite(
      FavoriteItemType.POST,
      postId,
      request.user.userId,
    );
  }

  @Delete('posts/:postId/favorite')
  @UseGuards(JwtAuthGuard)
  removePostFavorite(
    @Param('postId', ParseIntPipe) postId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.removeFavorite(
      FavoriteItemType.POST,
      postId,
      request.user.userId,
    );
  }

  @Put('replies/:replyId/favorite')
  @UseGuards(JwtAuthGuard)
  saveReply(
    @Param('replyId', ParseIntPipe) replyId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.saveFavorite(
      FavoriteItemType.REPLY,
      replyId,
      request.user.userId,
    );
  }

  @Delete('replies/:replyId/favorite')
  @UseGuards(JwtAuthGuard)
  removeReplyFavorite(
    @Param('replyId', ParseIntPipe) replyId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.removeFavorite(
      FavoriteItemType.REPLY,
      replyId,
      request.user.userId,
    );
  }

  @Put('products/:productId/favorite')
  @UseGuards(JwtAuthGuard)
  saveProduct(
    @Param('productId', ParseIntPipe) productId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.saveFavorite(
      FavoriteItemType.PRODUCT,
      productId,
      request.user.userId,
    );
  }

  @Delete('products/:productId/favorite')
  @UseGuards(JwtAuthGuard)
  removeProductFavorite(
    @Param('productId', ParseIntPipe) productId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.removeFavorite(
      FavoriteItemType.PRODUCT,
      productId,
      request.user.userId,
    );
  }
}
