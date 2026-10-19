import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class CreateConversationDto {
  @ApiProperty({
    type: Number,
    minimum: 1,
    example: 42,
    description: 'Producto sobre el que se abre la conversación',
  })
  @Type(() => Number)
  @IsInt({ message: 'productId debe ser un entero positivo' })
  @Min(1, { message: 'productId debe ser un entero positivo' })
  productId!: number;
}
