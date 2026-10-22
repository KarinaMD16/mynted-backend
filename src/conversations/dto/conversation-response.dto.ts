import { ApiProperty } from '@nestjs/swagger';

export class ConversationResponseDto {
  @ApiProperty({ type: Number, example: 15 })
  id!: number;

  @ApiProperty({ type: Number, example: 42 })
  productId!: number;

  @ApiProperty({ format: 'uuid', description: 'Usuario que inició el chat' })
  buyerId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Usuario dueño de la tienda del producto (no el sellerId)',
  })
  sellerId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Fecha del último mensaje; al crearla es igual a createdAt',
  })
  lastMessageAt!: Date;
}
