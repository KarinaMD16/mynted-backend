import { MessageCreatedResult, MessagesReadResult } from './messages.service';

// Eventos de dominio del chat. ConversationMessagesController los emite (con
// EventEmitter2 opcional) después de persistir, y ChatGateway los traduce a
// eventos de socket. MessagesService no conoce ni a uno ni al otro.
export const ConversationEvents = {
  MESSAGE_CREATED: 'conversation.message.created',
  MESSAGES_READ: 'conversation.messages.read',
} as const;

export type MessageCreatedEvent = MessageCreatedResult;

export type MessagesReadEvent = MessagesReadResult;
