import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'test@test.com' })
  @IsEmail({}, { message: 'El email no es válido' })
  email!: string;
}
