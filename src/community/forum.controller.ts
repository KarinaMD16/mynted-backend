import {
  Body,
  Controller,
  Delete,
  Get,
  Optional,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Sse,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Observable, fromEvent, interval, map, merge } from 'rxjs';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
  AuthenticatedRequest,
  OptionalAuthenticatedRequest,
} from '../auth/types/authenticated-request';
import { PostEvents, PostMetricsUpdatedEvent } from './post-events';
import { GetCommunityPostsQueryDto } from './dto/get-community-posts-query.dto';
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
import { FavoriteNotificationsDto } from './dto/favorite-notifications.dto';
import { FavoriteItemType } from './entities/favorite.entity';
import { ForumService } from './forum.service';
import {
  ApiDisplayCurrencyHeader,
  DisplayCurrency,
} from '../pricing/display-currency.decorator';

interface ForumFiles {
  images?: Express.Multer.File[];
}

@ApiTags('forum')
@ApiBearerAuth()
@Controller()
export class ForumController {
  constructor(
    private readonly forumService: ForumService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

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
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      'Posts de una comunidad. sort=hot (por defecto, upvotes/downvotes + frescura), new o top',
  })
  findPosts(
    @Param('communityId', ParseIntPipe) communityId: number,
    @Query() query: GetCommunityPostsQueryDto,
    @Req() request: OptionalAuthenticatedRequest,
  ) {
    return this.forumService.findPosts(communityId, request.user?.userId, query);
  }

  @Get('posts')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      'Feed global de comunidades públicas (funciona sin sesión). sort=hot (por defecto, upvotes/downvotes + frescura), new o top; search y tagIds filtran',
  })
  findGlobalPosts(
    @Query() query: GetGlobalPostsQueryDto,
    @Req() request: OptionalAuthenticatedRequest,
  ) {
    return this.forumService.findGlobalPosts(request.user?.userId, query);
  }

  @Get('home/posts')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      'Home: con sesión, posts de las comunidades a las que perteneces (meta.source = "joined"); sin sesión, o si aún no estás en ninguna, posts de comunidades públicas (meta.source = "public"). ' +
      'sort=hot (por defecto) pesa mucho lo reciente y usa los votos como empuje; new = solo recientes; top = más votos netos',
  })
  findHomePosts(
    @Query() query: GetCommunityPostsQueryDto,
    @Req() request: OptionalAuthenticatedRequest,
  ) {
    return this.forumService.findHomePosts(request.user?.userId, query);
  }

  // Stream en vivo (Server-Sent Events) con los contadores de los posts que
  // cambian. Debe ir antes de 'posts/:postId'.
  @Sse('posts/live')
  @ApiOperation({
    summary:
      'Stream en vivo (SSE, EventSource): evento "post-metrics" con { postId, upVotes, downVotes, timesSaved, replyCount } cada vez que cambian votos, guardados o respuestas de un post, más un "ping" cada 25 s. No reordena nada: el orden se recalcula al volver a pedir el feed',
  })
  liveMetrics(): Observable<MessageEvent> {
    const metrics = this.eventEmitter
      ? fromEvent(this.eventEmitter, PostEvents.METRICS_UPDATED).pipe(
          map(
            (event) =>
              ({
                type: 'post-metrics',
                data: event as PostMetricsUpdatedEvent,
              }) as MessageEvent,
          ),
        )
      : new Observable<MessageEvent>();
    const heartbeat = interval(25_000).pipe(
      map(() => ({ type: 'ping', data: {} }) as MessageEvent),
    );
    return merge(metrics, heartbeat);
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
  @ApiDisplayCurrencyHeader()
  findMyContent(
    @Query() query: GetMyFeedQueryDto,
    @Req() request: AuthenticatedRequest,
    @DisplayCurrency() displayCurrency: string,
  ) {
    return this.forumService.findMyContent(
      request.user.userId,
      query,
      displayCurrency,
    );
  }

  @Get('favorites/me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Posts y productos guardados como favoritos por el usuario autenticado, del más recientemente guardado al más antiguo. type: all | posts | products',
  })
  @ApiDisplayCurrencyHeader()
  findMyFavorites(
    @Query() query: GetMyContentQueryDto,
    @Req() request: AuthenticatedRequest,
    @DisplayCurrency() displayCurrency: string,
  ) {
    return this.forumService.findMyFavorites(
      request.user.userId,
      query,
      displayCurrency,
    );
  }

  @Get('users/me/recommended-posts')
  @UseGuards(JwtAuthGuard)
  findRecommendedPosts(
    @Query() query: GetPostsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.findRecommendedPosts(request.user.userId, query);
  }

  @Get('explore/forums/posts')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      'Explore "para ti" (funciona sin sesión): mezcla tus intereses, la popularidad (upvotes/downvotes) y la frescura, con bonus a comunidades que aún no conoces. Sin sesión o sin intereses, popularidad + frescura. Se recalcula en cada petición',
  })
  findExploreForumPosts(
    @Query() query: GetPostsQueryDto,
    @Req() request: OptionalAuthenticatedRequest,
  ) {
    return this.forumService.findRecommendedPosts(request.user?.userId, query);
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
  @UseGuards(OptionalJwtAuthGuard)
  findPost(
    @Param('postId', ParseIntPipe) postId: number,
    @Req() request: OptionalAuthenticatedRequest,
  ) {
    return this.forumService.findPost(postId, request.user?.userId);
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
  @UseGuards(OptionalJwtAuthGuard)
  findReplies(
    @Param('postId', ParseIntPipe) postId: number,
    @Req() request: OptionalAuthenticatedRequest,
  ) {
    return this.forumService.findReplies(postId, request.user?.userId);
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
  @ApiOperation({
    summary:
      'Guardar un producto en favoritos. Body opcional { notifyPrice?, notifyAvailability? } para activar avisos (si ya estaba guardado, los actualiza). Productos de comunidades privadas: solo miembros',
  })
  saveProduct(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() prefs: FavoriteNotificationsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.saveFavorite(
      FavoriteItemType.PRODUCT,
      productId,
      request.user.userId,
      prefs,
    );
  }

  @Patch('products/:productId/favorite')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Cambiar los avisos de un producto guardado (notifyPrice y/o notifyAvailability). No exige que siga activo. 404 si no está en favoritos',
  })
  updateProductFavorite(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() prefs: FavoriteNotificationsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forumService.updateFavoriteNotifications(
      productId,
      request.user.userId,
      prefs,
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
