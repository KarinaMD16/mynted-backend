import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Letras (con tildes, ñ y otras con diacríticos), espacios, apóstrofes (' y
// ’), guiones y puntos; debe empezar con una letra.
export const CARD_HOLDER_NAME_PATTERN = /^\p{L}[\p{L}\p{M} '’.-]*$/u;

// NFC (une tildes compuestas), recorta y colapsa espacios. Conserva
// mayúsculas y minúsculas.
export function normalizeCardHolderName(value: unknown): unknown {
  return typeof value === 'string'
    ? value.normalize('NFC').trim().replace(/\s+/g, ' ')
    : value;
}

export class PaymentCardDto {
  @ApiProperty({ example: '4242424242424242' })
  @IsString()
  @IsNotEmpty()
  cardNumber!: string;

  @ApiProperty({ example: 12, minimum: 1, maximum: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  expiryMonth!: number;

  @ApiProperty({ example: 2027, minimum: 1000, maximum: 9999 })
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(9999)
  expiryYear!: number;

  @ApiProperty({ example: '123', minLength: 3, maxLength: 4 })
  @IsString()
  @Matches(/^\d{3,4}$/)
  cvv!: string;

  @ApiProperty({
    example: 'María José Núñez',
    minLength: 2,
    maxLength: 80,
    description:
      'Nombre del titular como aparece en la tarjeta. Se guarda recortado y con los espacios repetidos colapsados',
  })
  @Transform(({ value }: TransformFnParams) => normalizeCardHolderName(value))
  @IsString({ message: 'El nombre del titular es obligatorio' })
  @IsNotEmpty({ message: 'El nombre del titular es obligatorio' })
  @Length(2, 80, {
    message: 'El nombre del titular debe tener entre 2 y 80 caracteres',
  })
  @Matches(CARD_HOLDER_NAME_PATTERN, {
    message:
      'El nombre del titular solo puede contener letras, espacios, apóstrofes, guiones y puntos',
  })
  cardHolderName!: string;
}
