import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import {
  MarkAllReadDto,
  NotificationDto,
  NotificationListQueryDto,
  UnreadCountDto,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

const NOT_FOUND = 'No existe o no es del usuario autenticado';

// Cada usuario solo ve y modifica las suyas. Las rutas literales
// (unread-count, read-all) van antes que ':id'.
@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Notificaciones del usuario, de la más reciente a la más antigua. unread=true: solo las no leídas',
  })
  list(
    @Query() query: NotificationListQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.notificationsService.list(request.user.userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Cantidad de notificaciones no leídas' })
  @ApiOkResponse({ type: UnreadCountDto })
  unreadCount(@Req() request: AuthenticatedRequest): Promise<UnreadCountDto> {
    return this.notificationsService.unreadCount(request.user.userId);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Marcar todas como leídas' })
  @ApiOkResponse({ type: MarkAllReadDto })
  markAllRead(@Req() request: AuthenticatedRequest): Promise<MarkAllReadDto> {
    return this.notificationsService.markAllRead(request.user.userId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Marcar una notificación como leída' })
  @ApiOkResponse({ type: NotificationDto })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<NotificationDto> {
    return this.notificationsService.markRead(request.user.userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Borrar una notificación' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: NOT_FOUND })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.notificationsService.remove(request.user.userId, id);
  }
}
