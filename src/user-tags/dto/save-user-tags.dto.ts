import {
  ArrayUnique,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;
}
