import { Logger, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WsJwtAuthenticator } from '../../auth/ws-jwt-authenticator';
import { CORS_OPTIONS } from '../../cors.config';
import {
  ConversationEvents,
  MessageCreatedEvent,
  MessagesReadEvent,
} from '../conversation-events';
import { otherParticipantId } from '../conversation-views';
import { ConversationsService } from '../conversations.service';
import { ChatPresence } from './chat-presence';
import {
  ChatSocketEvents,
  conversationRoom,
  InboxMessagePayload,
  InboxReadPayload,
  JoinConversationAck,
  LeaveConversationAck,
  MessageReadPayload,
  PresencePayload,
  userRoom,
} from './chat-socket.events';
import { ConversationRoomDto } from './conversation-room.dto';
import { WsAckExceptionFilter } from './ws-ack-exception.filter';

interface ChatSocketData {
  userId: string;
}

type ChatSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  ChatSocketData
>;

/**
 * Chat en tiempo real sobre el mismo puerto que la API. Solo traduce: la
 * persistencia y las reglas viven en los services, y los eventos de dominio
 * (ConversationEvents) llegan por EventEmitter2 tras guardar.
 *
 * Salas: `user:{id}` (todos los sockets de un usuario, se une al conectar) y
 * `conversation:{id}` (quien hizo conversation:join siendo participante).
 */
@WebSocketGateway({ cors: CORS_OPTIONS })
@UseFilters(new WsAckExceptionFilter())
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private readonly server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly authenticator: WsJwtAuthenticator,
    private readonly conversationsService: ConversationsService,
    private readonly presence: ChatPresence,
  ) {}

  // El handshake se valida en un middleware: una conexión sin sesión válida
  // se rechaza antes de existir (el cliente recibe connect_error).
  afterInit(server: Server) {
    server.use((socket: ChatSocket, next) => {
      this.authenticator
        .authenticate(socket.request)
        .then((user) => {
          socket.data.userId = user.userId;
          next();
        })
        .catch(() => next(new Error('No autenticado')));
    });
  }

  async handleConnection(socket: ChatSocket) {
    const { userId } = socket.data;
    // Antes de cualquier await, para que la sala y la presencia ya estén al
    // procesar el siguiente evento.
    const cameOnline = this.presence.connect(userId, socket.id);
    await socket.join(userRoom(userId));
    if (cameOnline) {
      await this.broadcastPresence(userId, ChatSocketEvents.PRESENCE_ONLINE);
    }
  }

  async handleDisconnect(socket: ChatSocket) {
    const { userId } = socket.data;
    if (!userId) return;
    if (this.presence.disconnect(userId, socket.id)) {
      await this.broadcastPresence(userId, ChatSocketEvents.PRESENCE_OFFLINE);
    }
  }

  // Solo comprador o vendedor entran a la sala; el error (403/404/400) vuelve
  // por el ack. Responde también si el otro participante está conectado.
  @SubscribeMessage(ChatSocketEvents.JOIN)
  async join(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() { conversationId }: ConversationRoomDto,
  ): Promise<JoinConversationAck> {
    const { userId } = socket.data;
    const conversation = await this.conversationsService.findForParticipant(
      conversationId,
      userId,
    );
    await socket.join(conversationRoom(conversation.id));

    const otherId = otherParticipantId(conversation, userId);
    return {
      ok: true,
      conversationId: conversation.id,
      otherParticipant: {
        userId: otherId,
        online: this.presence.isOnline(otherId),
      },
    };
  }

  @SubscribeMessage(ChatSocketEvents.LEAVE)
  async leave(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() { conversationId }: ConversationRoomDto,
  ): Promise<LeaveConversationAck> {
    await socket.leave(conversationRoom(conversationId));
    return { ok: true, conversationId };
  }

  // message:new a la sala de la conversación. Los sockets del destinatario
  // que no están en esa sala (bandeja abierta, otra pestaña) reciben
  // inbox:message en su sala personal para actualizar lista y badge.
  @OnEvent(ConversationEvents.MESSAGE_CREATED, { async: true })
  async onMessageCreated(event: MessageCreatedEvent) {
    const room = conversationRoom(event.conversationId);
    this.server.to(room).emit(ChatSocketEvents.MESSAGE_NEW, event.message);

    await this.withTotalUnread(event.recipientId, (totalUnread) => {
      const payload: InboxMessagePayload = { ...event.message, totalUnread };
      this.server
        .to(userRoom(event.recipientId))
        .except(room)
        .emit(ChatSocketEvents.INBOX_MESSAGE, payload);
    });
  }

  @OnEvent(ConversationEvents.MESSAGES_READ, { async: true })
  async onMessagesRead(event: MessagesReadEvent) {
    const payload: MessageReadPayload = {
      conversationId: event.conversationId,
      readerId: event.readerId,
      messageIds: event.messageIds,
      readAt: event.readAt,
    };
    this.server
      .to(conversationRoom(event.conversationId))
      .emit(ChatSocketEvents.MESSAGE_READ, payload);

    // Todas las pestañas/dispositivos del lector (incluida la que leyó)
    // actualizan bandeja y badge sin volver a pedir GET /conversations.
    await this.withTotalUnread(event.readerId, (totalUnread) => {
      const inboxPayload: InboxReadPayload = {
        conversationId: event.conversationId,
        unreadCount: event.unreadCount,
        totalUnread,
      };
      this.server
        .to(userRoom(event.readerId))
        .emit(ChatSocketEvents.INBOX_READ, inboxPayload);
    });
  }

  // Calcula el total de no leídos del usuario (después de persistir, así que
  // ya incluye el cambio) y emite. Si no tiene sockets en esta instancia no
  // hay a quién avisarle y se evita la consulta. Un fallo al contar solo
  // omite el aviso de bandeja; message:new y message:read ya salieron.
  private async withTotalUnread(
    userId: string,
    emit: (totalUnread: number) => void,
  ) {
    if (!this.presence.isOnline(userId)) return;
    try {
      emit(await this.conversationsService.getTotalUnread(userId));
    } catch (error: unknown) {
      this.logger.error(`No se pudo calcular totalUnread de ${userId}`, error);
    }
  }

  // Avisa a quienes comparten alguna conversación con el usuario. Las salas
  // user:{id} solo existen para usuarios conectados.
  private async broadcastPresence(
    userId: string,
    event:
      | typeof ChatSocketEvents.PRESENCE_ONLINE
      | typeof ChatSocketEvents.PRESENCE_OFFLINE,
  ) {
    try {
      const counterpartIds =
        await this.conversationsService.findCounterpartIds(userId);
      if (counterpartIds.length === 0) return;
      const payload: PresencePayload = { userId };
      this.server.to(counterpartIds.map(userRoom)).emit(event, payload);
    } catch (error: unknown) {
      this.logger.error(`No se pudo emitir ${event} de ${userId}`, error);
    }
  }
}
