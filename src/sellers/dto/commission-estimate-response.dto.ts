import { ApiProperty } from '@nestjs/swagger';

export class CommissionEstimateResponseDto {
  @ApiProperty({ example: 120000 })
  amount!: number;

  @ApiProperty({ example: 'CRC' })
  currency!: string;

  @ApiProperty({ example: 0.03 })
  commissionRate!: number;

  @ApiProperty({ example: 3600 })
  commissionAmount!: number;

  @ApiProperty({ example: 116400 })
  sellerNet!: number;

  @ApiProperty({ example: 'Oro' })
  salesTierName!: string;

  @ApiProperty({ example: 'Alto' })
  priceTierName!: string;

  @ApiProperty({ example: 0.01 })
  salesDiscount!: number;

  @ApiProperty({ example: 0.01 })
  priceDiscount!: number;
}
