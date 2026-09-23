import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform, TransformFnParams } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { parseBoolean } from '../../community/dto/create-community.dto';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'nuevo_username',
    description: 'Username único, de 3 a 20 caracteres',
  })
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'El username debe tener al menos 3 caracteres' })
  @MaxLength(20, { message: 'El username no puede superar 20 caracteres' })
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'El username solo puede contener letras, números y guión bajo',
  })
  username?: string;

  @ApiPropertyOptional({
    example: 'Coleccionista de Funko Pop desde 2015',
    description: 'Biografía del usuario',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'La bio no puede superar 500 caracteres' })
  bio?: string;

  @ApiPropertyOptional({
    example: 'San José, Costa Rica',
    description: 'Ubicación del usuario',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'La ubicación no puede superar 100 caracteres' })
  location?: string;

  @ApiPropertyOptional({
    example: 'es-CR',
    description: 'Locale del usuario',
  })
  @IsOptional()
  @IsString()
  @MaxLength(35, { message: 'El locale no puede superar 35 caracteres' })
  locale?: string;

  @ApiPropertyOptional({
    example: 'CRC',
    description: 'Moneda preferida del usuario',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10, { message: 'La moneda no puede superar 10 caracteres' })
  currency?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Preferencia de notificaciones por email',
  })
  @IsOptional()
  @Transform(({ value }: TransformFnParams) => parseBoolean(value as unknown))
  @IsBoolean({ message: 'emailNotifications debe ser un booleano' })
  emailNotifications?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Preferencia de notificaciones push',
  })
  @IsOptional()
  @Transform(({ value }: TransformFnParams) => parseBoolean(value as unknown))
  @IsBoolean({ message: 'pushNotifications debe ser un booleano' })
  pushNotifications?: boolean;
}
