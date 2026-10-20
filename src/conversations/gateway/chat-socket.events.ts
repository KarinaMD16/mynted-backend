import { MessageResponseDto } from '../dto/message-response.dto';

// Contrato de socket.io del chat (documentado en docs/GUIA_CHAT.md, sección 3).
export const ChatSocketEvents = {
  // cliente → servidor (responden por ack)
  JOIN: 'conversation:join',
  LEAVE: 'conversation:leave',
  // servidor → cliente
  MESSAGE_NEW: 'message:new',
  MESSAGE_READ: 'message:read',
  INBOX_MESSAGE: 'inbox:message',
  INBOX_READ: 'inbox:read',
  PRESENCE_ONLINE: 'presence:online',
  PRESENCE_OFFLINE: 'presence:offline',
} as const;

export const conversationRoom = (conversationId: number) =>
  `conversation:${conversationId}`;

export const userRoom = (userId: string) => `user:${userId}`;

export interface JoinConversationAck {
  ok: true;
  conversationId: number;
  otherParticipant: { userId: string; online: boolean };
}

export interface LeaveConversationAck {
  ok: true;
  conversationId: number;
}

export type MessageNewPayload = MessageResponseDto;

// El mensaje más el total de no leídos del destinatario (badge del nav).
export type InboxMessagePayload = MessageResponseDto & { totalUnread: number };

export interface MessageReadPayload {
  conversationId: number;
  readerId: string;
  messageIds: number[];
  readAt: Date | null;
}

export interface InboxReadPayload {
  conversationId: number;
  // No leídos que le quedan al lector en esa conversación.
  unreadCount: number;
  // No leídos del lector en todas sus conversaciones.
  totalUnread: number;
}

export interface PresencePayload {
  userId: string;
}
