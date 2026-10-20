import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { ConversationsService } from './conversations.service';
import { ConversationResponseDto } from './dto/conversation-response.dto';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { GetInboxQueryDto } from './dto/get-inbox-query.dto';
import { InboxResponseDto } from './dto/inbox-response.dto';
import { UnreadCountResponseDto } from './dto/unread-count-response.dto';

// El ValidationPipe global no transforma: sin transform los defaults y
// @Type/@Transform de los DTOs no llegarían al handler.
export const conversationsValidationPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

@ApiTags('conversations')
@Controller('conversations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Sin sesión o token vencido' })
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  @ApiOperation({
    summary:
      'Abrir (o recuperar) el chat con el vendedor de un producto. Idempotente: una conversación por comprador y producto',
  })
  @ApiCreatedResponse({
    type: ConversationResponseDto,
    description: 'Conversación creada',
  })
  @ApiOkResponse({
    type: ConversationResponseDto,
    description: 'Ya existía; se devuelve la misma conversación',
  })
  @ApiBadRequestResponse({
    description:
      'productId inválido (no es un entero positivo dentro de rango), o el producto no está activo o está oculto (solo al crear una nueva)',
  })
  @ApiForbiddenResponse({ description: 'El producto es tuyo' })
  @ApiNotFoundResponse({ description: 'Producto no encontrado' })
  async create(
    @Body(conversationsValidationPipe) dto: CreateConversationDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ConversationResponseDto> {
    const { conversation, created } =
      await this.conversationsService.findOrCreate(
        request.user.userId,
        dto.productId,
      );
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return conversation;
  }

  @Get()
  @ApiOperation({
    summary:
      'Bandeja del usuario (como comprador o vendedor), paginada y ordenada por último mensaje. Solo incluye conversaciones con al menos un mensaje',
  })
  @ApiOkResponse({ type: InboxResponseDto })
  @ApiBadRequestResponse({
    description: 'page o limit inválidos (limit máx. 50)',
  })
  getInbox(
    @Query(conversationsValidationPipe) query: GetInboxQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxResponseDto> {
    return this.conversationsService.getInbox(request.user.userId, query);
  }

  // Ruta literal: hoy no hay GET /conversations/:conversationId, pero si se
  // agrega debe declararse después de esta (Express matchea en orden de
  // registro) para que 'unread-count' no se tome como un id.
  @Get('unread-count')
  @ApiOperation({
    summary:
      'Total de mensajes sin leer del usuario en todas sus conversaciones (badge del nav)',
  })
  @ApiOkResponse({ type: UnreadCountResponseDto })
  async getUnreadCount(
    @Req() request: AuthenticatedRequest,
  ): Promise<UnreadCountResponseDto> {
    return {
      totalUnread: await this.conversationsService.getTotalUnread(
        request.user.userId,
      ),
    };
  }
}
