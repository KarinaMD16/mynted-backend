import { IsEmail, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'test@test.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Test1234' })
  @IsString()
  password!: string;
}
