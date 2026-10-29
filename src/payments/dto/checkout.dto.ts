import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentCardDto } from './payment-card.dto';
import { ShippingAddressDto } from './shipping-address.dto';

export class CheckoutDto {
  @ApiProperty({
    example: 42,
    description: 'ID del producto que se desea comprar',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId!: number;

  @ApiPropertyOptional({
    example: 2,
    default: 1,
    minimum: 1,
    maximum: 9999,
    description:
      'Unidades a comprar (por defecto 1). No puede superar el stock disponible. El monto es precio unitario × cantidad',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  quantity?: number;

  @ApiProperty({ type: PaymentCardDto })
  @ValidateNested()
  @Type(() => PaymentCardDto)
  card!: PaymentCardDto;

  @ApiProperty({ type: ShippingAddressDto })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress!: ShippingAddressDto;
}
