import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, ValidateNested } from 'class-validator';
import { PaymentCardDto } from '../../payments/dto/payment-card.dto';
import { SubscriptionPeriod } from '../subscription-period.enum';

export class SubscriptionCheckoutDto {
  @ApiProperty({
    enum: SubscriptionPeriod,
    example: SubscriptionPeriod.ANNUAL,
    description: 'Cuánto tiempo de Pro se paga',
  })
  @IsEnum(SubscriptionPeriod)
  period!: SubscriptionPeriod;

  @ApiProperty({ type: PaymentCardDto })
  @ValidateNested()
  @Type(() => PaymentCardDto)
  card!: PaymentCardDto;
}
