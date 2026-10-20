import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
}
