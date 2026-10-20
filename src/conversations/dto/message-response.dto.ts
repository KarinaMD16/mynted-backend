import { ApiProperty } from '@nestjs/swagger';
import { MessageType } from '../enums/message-type.enum';
import {
  ParticipantSummaryDto,
  ProductContextDto,
} from './conversation-context.dto';

export class MessageResponseDto {
  @ApiProperty({ type: Number, example: 120 })
  id!: number;

  @ApiProperty({ type: Number, example: 15 })
  conversationId!: number;

  @ApiProperty({ format: 'uuid' })
  senderId!: string;

  @ApiProperty({ enum: MessageType })
  type!: MessageType;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Texto del mensaje; null en mensajes 'image'",
  })
  content!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "URL de Cloudinary; null en mensajes 'text'",
  })
  imageUrl!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Cuándo lo leyó el destinatario; null = no leído',
  })
  readAt!: Date | null;
}

export class MessageHistoryConversationDto {
  @ApiProperty({ type: Number, example: 15 })
  id!: number;

  @ApiProperty({ type: ProductContextDto })
  product!: ProductContextDto;

  @ApiProperty({ type: ParticipantSummaryDto })
  otherParticipant!: ParticipantSummaryDto;
}

export class MessageHistoryResponseDto {
  @ApiProperty({ type: MessageHistoryConversationDto })
  conversation!: MessageHistoryConversationDto;

  @ApiProperty({
    type: [MessageResponseDto],
    description: 'Más recientes primero',
  })
  data!: MessageResponseDto[];

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Pasar como ?cursor= para la página siguiente (más antigua); null si no hay más',
  })
  nextCursor!: number | null;
}

export class MarkReadResponseDto {
  @ApiProperty({ type: Number, example: 15 })
  conversationId!: number;

  @ApiProperty({
    type: Number,
    example: 3,
    description: 'Mensajes marcados como leídos (0 si no había pendientes)',
  })
  markedCount!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'readAt aplicado; null si no se marcó ninguno',
  })
  readAt!: Date | null;
}
