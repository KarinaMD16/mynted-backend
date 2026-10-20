import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { MAX_INT4_ID } from './int-id';

export class CreateConversationDto {
  @ApiProperty({
    type: Number,
    minimum: 1,
    maximum: MAX_INT4_ID,
    example: 42,
    description: 'Producto sobre el que se abre la conversación',
  })
  @Type(() => Number)
  @IsInt({ message: 'productId debe ser un entero positivo' })
  @Min(1, { message: 'productId debe ser un entero positivo' })
  @Max(MAX_INT4_ID, { message: 'productId fuera de rango' })
  productId!: number;
}
