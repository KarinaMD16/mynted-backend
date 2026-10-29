import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaymentDisputeAction } from '../enums/payment-dispute-action.enum';

export class ResolvePaymentDisputeDto {
  @ApiProperty({ enum: PaymentDisputeAction })
  @IsEnum(PaymentDisputeAction)
  action!: PaymentDisputeAction;

  @ApiProperty({ maxLength: 1000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  resolution!: string;
}
