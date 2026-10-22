import { IsInt, Max, Min } from 'class-validator';
import { MAX_INT4_ID } from '../dto/int-id';

// Payload de conversation:join / conversation:leave. Sin @Type: por socket
// llega JSON, así que "15" (string) se rechaza en vez de convertirse.
export class ConversationRoomDto {
  @IsInt({ message: 'conversationId debe ser un entero positivo' })
  @Min(1, { message: 'conversationId debe ser un entero positivo' })
  @Max(MAX_INT4_ID, { message: 'conversationId fuera de rango' })
  conversationId!: number;
}
