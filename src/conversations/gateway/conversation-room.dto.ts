import { IsInt, Min } from 'class-validator';

// Payload de conversation:join / conversation:leave. Sin @Type: por socket
// llega JSON, así que "15" (string) se rechaza en vez de convertirse.
export class ConversationRoomDto {
  @IsInt({ message: 'conversationId debe ser un entero positivo' })
  @Min(1, { message: 'conversationId debe ser un entero positivo' })
  conversationId!: number;
}
