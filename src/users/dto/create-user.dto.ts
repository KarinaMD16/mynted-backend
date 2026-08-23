import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({
    example: 'test@test.com',
    description: 'Email único del usuario',
  })
  @IsEmail({}, { message: 'El email no es válido' })
  email!: string;

  @ApiProperty({
    example: 'testuser',
    description: 'Username único, 3-20 caracteres',
  })
  @IsString()
  @MinLength(3, { message: 'El username debe tener al menos 3 caracteres' })
  @MaxLength(20, { message: 'El username no puede superar 20 caracteres' })
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'El username solo puede contener letras, números y guión bajo',
  })
  username!: string;

  @ApiProperty({
    example: 'Test1234',
    description:
      'Mínimo 8 caracteres, con mayúscula, minúscula y número/símbolo',
  })
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message:
      'La contraseña debe tener al menos una mayúscula, una minúscula y un número o símbolo',
  })
  password!: string;
}
