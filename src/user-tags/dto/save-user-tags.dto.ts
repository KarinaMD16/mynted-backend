import {
  ArrayUnique,
  IsInt,
  IsOptional,
  IsIn,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform, TransformFnParams } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SUPPORTED_CURRENCIES } from '../../payments/exchange-rate/exchange-rate.constants';

export class SaveUserTagsDto {
  @ApiProperty({
    example: [1, 2, 3],
    description:
      'IDs de tags principales (isInterest = true) elegidos en el onboarding. ' +
      'Debe traer 0 (flujo "Omitir por ahora") o al menos 3.',
    type: [Number],
  })
  @ArrayUnique()
  @IsInt({ each: true })
  tagIds!: number[];

  @ApiPropertyOptional({
    example: '2026-01-01',
    description:
      'Versión de la política de privacidad que el usuario aceptó en el onboarding',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  privacyPolicyVersion?: string;

  @ApiPropertyOptional({
    example: 'es-CR',
    description: 'Locale detectado del navegador del usuario',
  })
  @IsOptional()
  @IsString()
  @MaxLength(35)
  locale?: string;

  @ApiPropertyOptional({
    example: 'CRC',
    description: 'Moneda detectada del navegador del usuario',
  })
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim().toUpperCase() : (value as unknown),
  )
  @IsOptional()
  @IsString()
  @MaxLength(10)
  @IsIn(SUPPORTED_CURRENCIES, {
    message: 'La moneda no está soportada por Mynted',
  })
  currency?: string;
}
