import { Type } from 'class-transformer';
import { IsInt, Min, ValidateNested } from 'class-validator';
import { PaymentCardDto } from './payment-card.dto';

export class CheckoutDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId!: number;

  @ValidateNested()
  @Type(() => PaymentCardDto)
  card!: PaymentCardDto;
}
