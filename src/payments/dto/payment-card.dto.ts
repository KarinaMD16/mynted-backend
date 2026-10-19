import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class PaymentCardDto {
  @IsString()
  @IsNotEmpty()
  cardNumber!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  expiryMonth!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(9999)
  expiryYear!: number;

  @IsString()
  @Matches(/^\d{3,4}$/)
  cvv!: string;
}
