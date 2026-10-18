import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { UsersService } from '../users/users.service';
import { BadgesService } from './badges.service';
import { BackfillResultDto, BadgeItemDto } from './dto/badge-item.dto';
import { BadgeScope } from './entities/badge.entity';
import { ParseOptionalScopePipe } from './parse-optional-scope.pipe';

@ApiTags('badges')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class BadgesController {
  constructor(
    private readonly badgesService: BadgesService,
    private readonly usersService: UsersService,
  ) {}

  @Get('badges')
  @ApiOperation({
    summary:
      'Catálogo de badges activos (para pintar también los bloqueados). Orden: rareza descendente',
  })
  @ApiQuery({ name: 'scope', required: false, enum: BadgeScope })
  @ApiOkResponse({ type: [BadgeItemDto] })
  findCatalog(
    @Query('scope', ParseOptionalScopePipe) scope?: BadgeScope,
  ): Promise<BadgeItemDto[]> {
    return this.badgesService.findCatalog(scope);
  }

  // Debe ir antes de 'users/:userId/badges'.
  @Get('users/me/badges')
  @ApiOperation({ summary: 'Badges de usuario del autenticado' })
  @ApiOkResponse({ type: [BadgeItemDto] })
  findMyBadges(@Req() request: AuthenticatedRequest): Promise<BadgeItemDto[]> {
    return this.badgesService.findUserBadges(request.user.userId);
  }

  @Get('users/:userId/badges')
  @ApiOperation({
    summary:
      'Badges de usuario de un perfil público, por rareza descendente y luego awardedAt descendente',
  })
  @ApiOkResponse({ type: [BadgeItemDto] })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado' })
  async findUserBadges(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<BadgeItemDto[]> {
    await this.usersService.findPublicById(userId);
    return this.badgesService.findUserBadges(userId);
  }

  @Get('community-profiles/:communityProfileId/badges')
  @ApiOperation({
    summary:
      'Badges de un communityProfile: ganados + derivados del rol (community_founder / moderator con derived: true y awardedAt: null). En comunidades privadas, solo miembros',
  })
  @ApiOkResponse({ type: [BadgeItemDto] })
  @ApiNotFoundResponse({ description: 'Perfil no encontrado' })
  @ApiForbiddenResponse({ description: 'Comunidad privada y no eres miembro' })
  findProfileBadges(
    @Param('communityProfileId', ParseIntPipe) communityProfileId: number,
    @Req() request: AuthenticatedRequest,
  ): Promise<BadgeItemDto[]> {
    return this.badgesService.findCommunityProfileBadges(
      communityProfileId,
      request.user.userId,
    );
  }
}

@ApiTags('badges')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('admin/badges')
export class AdminBadgesController {
  constructor(private readonly badgesService: BadgesService) {}

  @Post('backfill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '[Superadmin] Evalúa los datos existentes y otorga retroactivamente los badges que correspondan. Idempotente',
  })
  @ApiOkResponse({ type: BackfillResultDto })
  async backfill(): Promise<BackfillResultDto> {
    return { awarded: await this.badgesService.backfill() };
  }
}
