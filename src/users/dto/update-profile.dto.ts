import {
  IsBoolean,
  IsISO31661Alpha2,
  IsISO4217CurrencyCode,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform, TransformFnParams } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { parseBoolean } from '../../community/dto/create-community.dto';
import { SUPPORTED_CURRENCIES } from '../../payments/exchange-rate/exchange-rate.constants';
import { IsBcp47Locale } from '../../common/is-bcp47-locale';

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
    description: 'Locale del usuario (etiqueta BCP 47)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(35, { message: 'El locale no puede superar 35 caracteres' })
  @IsBcp47Locale()
  locale?: string;

  @ApiPropertyOptional({
    example: 'CRC',
    description:
      'Moneda de venta y de comisión (la de los productos nuevos del vendedor). No cambia la moneda en que se muestran los precios: eso es displayCurrency',
  })
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim().toUpperCase() : (value as unknown),
  )
  @IsOptional()
  @IsISO4217CurrencyCode({
    message: 'La moneda debe ser un código ISO 4217 (p. ej. CRC, USD)',
  })
  @IsIn(SUPPORTED_CURRENCIES, {
    message: 'La moneda no está soportada por Mynted',
  })
  currency?: string;

  @ApiPropertyOptional({
    example: 'USD',
    description:
      'Moneda en la que el usuario quiere ver los precios (solo visualización)',
  })
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim().toUpperCase() : (value as unknown),
  )
  @IsOptional()
  @IsISO4217CurrencyCode({
    message: 'displayCurrency debe ser un código ISO 4217 (p. ej. CRC, USD)',
  })
  @IsIn(SUPPORTED_CURRENCIES, {
    message: 'displayCurrency no está soportada por Mynted',
  })
  displayCurrency?: string;

  @ApiPropertyOptional({
    example: 'CR',
    description: 'País del usuario (ISO 3166-1 alfa-2)',
  })
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim().toUpperCase() : (value as unknown),
  )
  @IsOptional()
  @IsISO31661Alpha2({
    message: 'El país debe ser un código ISO 3166-1 alfa-2 (p. ej. CR, MX)',
  })
  country?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Pedir confirmación antes de quitar un favorito',
  })
  @IsOptional()
  @Transform(({ value }: TransformFnParams) => parseBoolean(value as unknown))
  @IsBoolean({ message: 'confirmUnfavorite debe ser un booleano' })
  confirmUnfavorite?: boolean;

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
