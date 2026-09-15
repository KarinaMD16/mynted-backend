import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaymentType } from '../entities/payment-info.entity';

export class RequestSellerDto {
  @ApiProperty({ example: 'Funko Corner CR' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre del vendedor es requerido' })
  @MaxLength(100)
  displayName!: string;

  @ApiProperty({
    example: 'Vendo figuras y funkos originales, envíos a todo el país',
  })
  @IsString()
  @IsNotEmpty({ message: 'La descripción es requerida' })
  @MaxLength(1000)
  description!: string;

  @ApiProperty({ example: 'San José, Costa Rica' })
  @IsString()
  @IsNotEmpty({ message: 'La ubicación es requerida' })
  @MaxLength(150)
  location!: string;

  @ApiProperty({ example: 'Juan Pérez Rodríguez' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre del titular es requerido' })
  @MaxLength(150)
  ownerFullName!: string;

  @ApiProperty({
    example: 'BAC San José',
    description: 'Nombre del banco, o del titular de la cuenta PayPal',
  })
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la cuenta/banco es requerido' })
  @MaxLength(150)
  name!: string;

  @ApiProperty({
    example: 'CR12345678901234567890',
    description: 'Número de cuenta/IBAN, o el correo de la cuenta PayPal',
  })
  @IsString()
  @IsNotEmpty({ message: 'El número de cuenta es requerido' })
  @MaxLength(50)
  number!: string;

  @ApiProperty({ enum: PaymentType, example: PaymentType.BANK_ACCOUNT })
  @IsEnum(PaymentType, { message: 'type debe ser bank_account o paypal' })
  type!: PaymentType;
}
