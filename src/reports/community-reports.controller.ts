import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { CommunityProfileRole } from '../community/entities/community-profile.entity';
import { CommunityRoleGuard } from '../community/guards/community-role.guard';
import { RequireCommunityRole } from '../community/decorators/require-community-role.decorator';
import { CommunityReportsQueryDto } from './dto/community-reports-query.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
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

  @Patch('reports/:id/resolve')
  @UseGuards(JwtAuthGuard, CommunityRoleGuard)
  @RequireCommunityRole(
    CommunityProfileRole.MODERATOR,
    CommunityProfileRole.OWNER,
  )
  @ApiOperation({ summary: 'Resolver un reporte de la comunidad' })
  @ApiParam({ name: 'communityId', type: Number })
  @ApiParam({ name: 'id', type: Number })
  @ApiBody({
    type: ResolveReportDto,
    description: 'Debe seleccionarse al menos una acción real',
  })
  @ApiOkResponse({ description: 'Reporte resuelto' })
  @ApiBadRequestResponse({ description: 'Acciones inválidas' })
  @ApiUnauthorizedResponse({ description: 'Se requiere autenticación' })
  @ApiForbiddenResponse({ description: 'No tienes permisos de moderación' })
  @ApiNotFoundResponse({ description: 'Reporte o comunidad no encontrada' })
  @ApiConflictResponse({ description: 'El reporte ya fue resuelto' })
  resolve(
    @Param('communityId', ParseIntPipe) communityId: number,
    @Param('id', ParseIntPipe) reportId: number,
    @Body(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    dto: ResolveReportDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reportsService.resolveCommunityReport(
      communityId,
      reportId,
      dto,
      request.user.userId,
    );
  }

  @Patch('reports/:id/dismiss')
  @UseGuards(JwtAuthGuard, CommunityRoleGuard)
  @RequireCommunityRole(
    CommunityProfileRole.MODERATOR,
    CommunityProfileRole.OWNER,
  )
  @ApiOperation({ summary: 'Descartar un reporte de la comunidad' })
  @ApiParam({ name: 'communityId', type: Number })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ description: 'Reporte descartado' })
  @ApiUnauthorizedResponse({ description: 'Se requiere autenticación' })
  @ApiForbiddenResponse({ description: 'No tienes permisos de moderación' })
  @ApiNotFoundResponse({ description: 'Reporte o comunidad no encontrada' })
  @ApiConflictResponse({ description: 'El reporte ya fue resuelto' })
  dismiss(
    @Param('communityId', ParseIntPipe) communityId: number,
    @Param('id', ParseIntPipe) reportId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reportsService.dismissCommunityReport(
      communityId,
      reportId,
      request.user.userId,
    );
  }
}
