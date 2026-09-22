import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    example: 'test@test.com',
    description: 'Email o username del usuario',
  })
  @IsString()
  @IsNotEmpty({ message: 'El email o username es requerido' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: 'Test1234' })
  @IsString()
  password!: string;
}
