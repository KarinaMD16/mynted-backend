import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { UsersService } from '../users/users.service';
import { GetMyFeedQueryDto } from './dto/get-my-feed-query.dto';
import { GetMyPostsQueryDto } from './dto/get-my-posts-query.dto';
import { ForumService } from './forum.service';

/**
 * Contenido público de un usuario: solo comunidades públicas y activas, y
 * productos activos. Reutiliza la lógica de /posts/me y /forums/me.
 */
@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users/:id')
export class PublicProfileController {
  constructor(
    private readonly forumService: ForumService,
    private readonly usersService: UsersService,
  ) {}

  @Get('posts')
  @ApiOperation({
    summary:
      'Posts y productos publicados por un usuario, mezclados por fecha (solo contenido público)',
  })
  async findPosts(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: GetMyFeedQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.usersService.findPublicById(id);
    return this.forumService.findUserContent(
      id,
      request.user.userId,
      query,
      true,
    );
  }

  @Get('forums')
  @ApiOperation({
    summary:
      'Posts de foro de un usuario, ordenables por fecha, upvotes, downvotes o guardados (solo comunidades públicas)',
  })
  async findForums(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: GetMyPostsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.usersService.findPublicById(id);
    return this.forumService.findUserPosts(
      id,
      request.user.userId,
      query,
      true,
    );
  }

  @Get('products')
  @ApiOperation({
    summary:
      'Productos activos de un usuario vendedor, paginados (solo comunidades públicas)',
  })
  async findProducts(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: GetMyFeedQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.usersService.findPublicById(id);
    return this.forumService.findUserProducts(id, request.user.userId, query);
  }
}
