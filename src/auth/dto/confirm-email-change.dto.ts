import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConfirmEmailChangeDto {
  @ApiProperty({
    description: 'Token de confirmación recibido en el nuevo correo',
  })
  @IsString()
  token!: string;
}
