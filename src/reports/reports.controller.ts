import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { CreateReportDto } from './dto/create-report.dto';
import { Report } from './entities/report.entity';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Reportar una publicación, respuesta, producto o conversación',
  })
  @ApiCreatedResponse({ type: Report })
  @ApiBadRequestResponse({
    description: 'Datos inválidos o intento de reportar contenido propio',
  })
  @ApiUnauthorizedResponse({ description: 'Se requiere autenticación' })
  @ApiForbiddenResponse({
    description: 'El usuario no participa en la conversación',
  })
  @ApiNotFoundResponse({ description: 'El contenido reportado no existe' })
  @ApiConflictResponse({ description: 'El usuario ya reportó este contenido' })
  create(
    @Body() dto: CreateReportDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<Report> {
    return this.reportsService.createReport(request.user.userId, dto);
  }
}
