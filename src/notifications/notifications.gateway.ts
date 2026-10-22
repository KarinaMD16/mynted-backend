import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { userRoom } from '../common/socket-rooms';
import { CORS_OPTIONS } from '../cors.config';
import { NotificationDto } from './dto/notification.dto';

export const NotificationSocketEvents = {
  // Notificación nueva (o unificada: vuelve arriba con su data nueva).
  NEW: 'notification:new',
  // El contador cambió por leer o borrar (sincroniza otras pestañas).
  UNREAD_COUNT: 'notification:unread-count',
} as const;

export interface NotificationNewPayload {
  notification: NotificationDto;
  unreadCount: number;
}

export interface UnreadCountPayload {
  unreadCount: number;
}

/**
 * Solo emite: no maneja conexiones ni mensajes. Comparte el servidor
 * socket.io de ChatGateway (mismo puerto y namespace), que es quien autentica
 * el handshake y une cada socket a su sala user:{id}.
 */
@WebSocketGateway({ cors: CORS_OPTIONS })
export class NotificationsGateway {
  @WebSocketServer()
  private readonly server?: Server;

  emitNew(userId: string, payload: NotificationNewPayload): void {
    this.server
      ?.to(userRoom(userId))
      .emit(NotificationSocketEvents.NEW, payload);
  }

  emitUnreadCount(userId: string, payload: UnreadCountPayload): void {
    this.server
      ?.to(userRoom(userId))
      .emit(NotificationSocketEvents.UNREAD_COUNT, payload);
  }
}
