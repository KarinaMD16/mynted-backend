import { ApiProperty } from '@nestjs/swagger';
import { MessageType } from '../enums/message-type.enum';
import {
  ParticipantSummaryDto,
  ProductSummaryDto,
} from './conversation-context.dto';

export class InboxLastMessageDto {
  @ApiProperty({ type: Number, example: 120 })
  id!: number;

  @ApiProperty({
    enum: MessageType,
    description: "'image' indica que el último mensaje fue una imagen",
  })
  type!: MessageType;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Texto del mensaje; null si type es 'image'",
  })
  content!: string | null;

  @ApiProperty({ format: 'uuid' })
  senderId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class InboxItemDto {
  @ApiProperty({ type: Number, example: 15 })
  id!: number;

  @ApiProperty({ type: ParticipantSummaryDto })
  otherParticipant!: ParticipantSummaryDto;

  @ApiProperty({ type: ProductSummaryDto })
  product!: ProductSummaryDto;

  @ApiProperty({ type: InboxLastMessageDto })
  lastMessage!: InboxLastMessageDto;

  @ApiProperty({
    type: Number,
    example: 2,
    description: 'Mensajes del otro participante sin leer',
  })
  unreadCount!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  lastMessageAt!: Date;
}

export class InboxPaginationDto {
  @ApiProperty({ type: Number, example: 1 })
  page!: number;

  @ApiProperty({ type: Number, example: 20 })
  limit!: number;

  @ApiProperty({ type: Number, example: 3 })
  total!: number;

  @ApiProperty({ type: Number, example: 1 })
  totalPages!: number;
}

export class InboxResponseDto {
  @ApiProperty({ type: [InboxItemDto] })
  data!: InboxItemDto[];

  @ApiProperty({ type: InboxPaginationDto })
  pagination!: InboxPaginationDto;
}
