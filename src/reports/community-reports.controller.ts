import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CommunityProfileRole } from '../community/entities/community-profile.entity';
import { CommunityRoleGuard } from '../community/guards/community-role.guard';
import { RequireCommunityRole } from '../community/decorators/require-community-role.decorator';
import { CommunityReportsQueryDto } from './dto/community-reports-query.dto';
import { ReportsService } from './reports.service';

@ApiTags('community-reports')
@ApiBearerAuth()
@Controller('communities/:communityId')
export class CommunityReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('reports')
  @UseGuards(JwtAuthGuard, CommunityRoleGuard)
  @RequireCommunityRole(
    CommunityProfileRole.MODERATOR,
    CommunityProfileRole.OWNER,
  )
  @ApiOperation({ summary: 'Listar reportes de una comunidad' })
  @ApiParam({ name: 'communityId', type: Number })
  @ApiOkResponse({ description: 'Reportes paginados y contadores por estado' })
  @ApiBadRequestResponse({ description: 'Query inválida' })
  @ApiUnauthorizedResponse({ description: 'Se requiere autenticación' })
  @ApiForbiddenResponse({ description: 'No tienes permisos de moderación' })
  @ApiNotFoundResponse({ description: 'Comunidad no encontrada' })
  list(
    @Param('communityId', ParseIntPipe) communityId: number,
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: CommunityReportsQueryDto,
  ) {
    return this.reportsService.listCommunityReports(communityId, query);
  }

  @Get('reports/:id')
  @UseGuards(JwtAuthGuard, CommunityRoleGuard)
  @RequireCommunityRole(
    CommunityProfileRole.MODERATOR,
    CommunityProfileRole.OWNER,
  )
  @ApiOperation({ summary: 'Consultar el detalle de un reporte' })
  @ApiParam({ name: 'communityId', type: Number })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ description: 'Detalle del reporte y contenido reportado' })
  @ApiUnauthorizedResponse({ description: 'Se requiere autenticación' })
  @ApiForbiddenResponse({ description: 'No tienes permisos de moderación' })
  @ApiNotFoundResponse({ description: 'Reporte o comunidad no encontrada' })
  detail(
    @Param('communityId', ParseIntPipe) communityId: number,
    @Param('id', ParseIntPipe) reportId: number,
  ) {
    return this.reportsService.getCommunityReportDetail(communityId, reportId);
  }

  @Get('moderation/stats')
  @UseGuards(JwtAuthGuard, CommunityRoleGuard)
  @RequireCommunityRole(
    CommunityProfileRole.MODERATOR,
    CommunityProfileRole.OWNER,
  )
  @ApiOperation({ summary: 'Consultar estadísticas de moderación' })
  @ApiParam({ name: 'communityId', type: Number })
  @ApiOkResponse({ description: 'Estadísticas de reportes y miembros' })
  @ApiUnauthorizedResponse({ description: 'Se requiere autenticación' })
  @ApiForbiddenResponse({ description: 'No tienes permisos de moderación' })
  @ApiNotFoundResponse({ description: 'Comunidad no encontrada' })
  stats(@Param('communityId', ParseIntPipe) communityId: number) {
    return this.reportsService.getModerationStats(communityId);
  }
}
