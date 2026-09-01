import { IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ example: 'Test1234' })
  @IsString()
  currentPassword!: string;

  @ApiProperty({
    example: 'NewTest1234',
    description:
      'Mínimo 8 caracteres, con mayúscula, minúscula y número/símbolo',
  })
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @MaxLength(72, { message: 'La contraseña no puede superar 72 caracteres' })
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message:
      'La contraseña debe tener al menos una mayúscula, una minúscula y un número o símbolo',
  })
  newPassword!: string;
}
