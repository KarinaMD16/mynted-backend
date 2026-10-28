import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiParam,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { CreateReportDto } from './dto/create-report.dto';
import { GetReportsQueryDto } from './dto/get-reports-query.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @ApiOperation({ summary: '[Superadmin] Listar reportes globales' })
  @ApiOkResponse({ description: 'Reportes globales paginados y contadores' })
  @ApiUnauthorizedResponse({ description: 'Se requiere autenticaciÃ³n' })
  @ApiForbiddenResponse({
    description: 'Requiere permisos de superadministrador',
  })
  list(
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: GetReportsQueryDto,
  ) {
    return this.reportsService.listGlobalReports(query);
  }

  @Patch(':id/resolve')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @ApiOperation({ summary: '[Superadmin] Resolver un reporte global' })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ description: 'Reporte resuelto' })
  @ApiBadRequestResponse({ description: 'Acciones invÃ¡lidas' })
  @ApiUnauthorizedResponse({ description: 'Se requiere autenticaciÃ³n' })
  @ApiForbiddenResponse({
    description: 'Requiere permisos de superadministrador',
  })
  resolve(
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
    return this.reportsService.resolveGlobalReport(
      reportId,
      dto,
      request.user.userId,
    );
  }

  @Patch(':id/dismiss')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @ApiOperation({ summary: '[Superadmin] Descartar un reporte global' })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ description: 'Reporte descartado' })
  @ApiUnauthorizedResponse({ description: 'Se requiere autenticaciÃ³n' })
  @ApiForbiddenResponse({
    description: 'Requiere permisos de superadministrador',
  })
  dismiss(
    @Param('id', ParseIntPipe) reportId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reportsService.dismissGlobalReport(
      reportId,
      request.user.userId,
    );
  }

  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Reportar una publicación, respuesta, producto o conversación',
  })
  @ApiCreatedResponse({ description: 'Reporte creado' })
  @ApiBadRequestResponse({
    description: 'Datos inválidos o intento de reportar contenido propio',
  })
  @ApiUnauthorizedResponse({ description: 'Se requiere autenticación' })
  @ApiForbiddenResponse({
    description: 'El usuario no participa en la conversación',
  })
  @ApiNotFoundResponse({ description: 'El contenido reportado no existe' })
  @ApiConflictResponse({ description: 'El usuario ya reportó este contenido' })
  create(@Body() dto: CreateReportDto, @Req() request: AuthenticatedRequest) {
    return this.reportsService.createReport(request.user.userId, dto);
  }
}
