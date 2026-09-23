import { IsEmail, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestEmailChangeDto {
  @ApiProperty({ example: 'nuevo@test.com' })
  @IsEmail({}, { message: 'El nuevo email no es válido' })
  @MaxLength(255)
  newEmail!: string;
}
