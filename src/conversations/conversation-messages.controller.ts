import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';
import 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { conversationsValidationPipe } from './conversations.controller';
import { CreateTextMessageDto } from './dto/create-text-message.dto';
import { GetMessagesQueryDto } from './dto/get-messages-query.dto';
import {
  MarkReadResponseDto,
  MessageHistoryResponseDto,
  MessageResponseDto,
} from './dto/message-response.dto';
import {
  ConversationParticipantGuard,
  ConversationParticipantRequest,
} from './guards/conversation-participant.guard';
import {
  MESSAGE_IMAGE_FIELD,
  MessageImageInterceptor,
} from './interceptors/message-image.interceptor';
import { MessagesService } from './messages.service';

// Todas las rutas exigen ser comprador o vendedor de :conversationId; el
// guard deja la conversación en req.conversation. Los guards corren antes que
// los interceptores, así que a un no participante ni se le procesa el archivo.
@ApiTags('conversations')
@Controller('conversations/:conversationId')
@UseGuards(JwtAuthGuard, ConversationParticipantGuard)
@ApiBearerAuth()
@ApiParam({ name: 'conversationId', type: Number, example: 15 })
@ApiForbiddenResponse({ description: 'No participas en esta conversación' })
@ApiNotFoundResponse({ description: 'Conversación no encontrada' })
export class ConversationMessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('messages')
  @ApiOperation({
    summary:
      'Historial de mensajes, más recientes primero, paginado por cursor. Incluye el contexto del producto y el otro participante',
  })
  @ApiOkResponse({ type: MessageHistoryResponseDto })
  @ApiBadRequestResponse({ description: 'cursor o limit inválidos' })
  getHistory(
    @Query(conversationsValidationPipe) query: GetMessagesQueryDto,
    @Req() request: ConversationParticipantRequest,
  ): Promise<MessageHistoryResponseDto> {
    return this.messagesService.getHistory(
      request.conversation,
      request.user.userId,
      query,
    );
  }

  @Post('messages')
  @ApiOperation({
    summary:
      "Enviar un mensaje de texto. El body solo acepta content; type 'text' lo fija el servidor",
  })
  @ApiCreatedResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({
    description:
      'content vacío o de más de 2000 caracteres, o el body trae campos extra (type, imageUrl...)',
  })
  async sendText(
    @Body(conversationsValidationPipe) dto: CreateTextMessageDto,
    @Req() request: ConversationParticipantRequest,
  ): Promise<MessageResponseDto> {
    const { message } = await this.messagesService.sendText(
      request.conversation,
      request.user.userId,
      dto,
    );
    return message;
  }

  @Post('messages/image')
  @UseInterceptors(MessageImageInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [MESSAGE_IMAGE_FIELD],
      properties: {
        [MESSAGE_IMAGE_FIELD]: {
          type: 'string',
          format: 'binary',
          description:
            'JPG, PNG o WEBP de hasta 5 MB. No se aceptan otros campos',
        },
      },
    },
  })
  @ApiOperation({
    summary:
      "Enviar una imagen. Se sube a Cloudinary y el mensaje 'image' se crea con la URL resultante (sin pie de foto)",
  })
  @ApiCreatedResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({
    description:
      'Falta el archivo, formato no permitido, imagen inválida o el multipart trae campos de texto',
  })
  @ApiPayloadTooLargeResponse({ description: 'La imagen supera 5 MB' })
  @ApiBadGatewayResponse({
    description: 'No se pudo subir a Cloudinary; no se creó el mensaje',
  })
  async sendImage(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: ConversationParticipantRequest,
  ): Promise<MessageResponseDto> {
    const { message } = await this.messagesService.sendImage(
      request.conversation,
      request.user.userId,
      file,
    );
    return message;
  }

  @Patch('read')
  @ApiOperation({
    summary:
      'Marcar como leídos los mensajes del otro participante. Idempotente: si no hay pendientes responde con markedCount 0',
  })
  @ApiOkResponse({ type: MarkReadResponseDto })
  async markAsRead(
    @Req() request: ConversationParticipantRequest,
  ): Promise<MarkReadResponseDto> {
    const { conversationId, markedCount, readAt } =
      await this.messagesService.markAsRead(
        request.conversation,
        request.user.userId,
      );
    return { conversationId, markedCount, readAt };
  }
}
