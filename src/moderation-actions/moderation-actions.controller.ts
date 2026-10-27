import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { ModerationActionQueryDto } from './dto/moderation-action-query.dto';
import { ModerationActionListResponseDto } from './dto/moderation-action-response.dto';
import { ModerationActionsService } from './moderation-actions.service';

@ApiTags('moderation-log')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('moderation-log')
export class ModerationActionsController {
  constructor(private readonly service: ModerationActionsService) {}

  @Get()
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({ summary: 'Consultar el registro de acciones de moderación' })
  @ApiOkResponse({ type: ModerationActionListResponseDto })
  @ApiUnauthorizedResponse({ description: 'Se requiere autenticación' })
  @ApiForbiddenResponse({
    description: 'Requiere permisos de superadministrador',
  })
  findAll(@Query() query: ModerationActionQueryDto) {
    return this.service.findAll(query);
  }
}
