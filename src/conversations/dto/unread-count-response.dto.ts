import { ApiProperty } from '@nestjs/swagger';

export class UnreadCountResponseDto {
  @ApiProperty({
    type: Number,
    example: 4,
    description:
      'Mensajes sin leer del usuario en todas sus conversaciones (enviados por el otro participante)',
  })
  totalUnread!: number;
}
