import { Type } from 'class-transformer';
import { IsInt, Min, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaymentCardDto } from './payment-card.dto';

export class CheckoutDto {
  @ApiProperty({ example: 42, description: 'ID del producto que se desea comprar' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId!: number;

  @ApiProperty({ type: PaymentCardDto })
  @ValidateNested()
  @Type(() => PaymentCardDto)
  card!: PaymentCardDto;
}
