import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SalesTierDisplayDto {
  name!: string;
  minValue!: number;
  maxValue!: number | null;
  discount!: number;
}

export class PriceTierDisplayDto {
  name!: string;
  minValue!: number;
  maxValue!: number | null;
  discount!: number;
  currency!: string;
  approximate!: boolean;
}

export class CommissionRateCellDto {
  priceTierName!: string;
  priceDiscount!: number;
  commissionRate!: number;
}

export class CommissionMatrixRowDto {
  salesTierName!: string;
  salesDiscount!: number;
  rates!: CommissionRateCellDto[];
}

export class CommissionTiersResponseDto {
  @ApiProperty({ example: 'CRC' })
  currency!: string;
  @ApiProperty({ type: [SalesTierDisplayDto] })
  salesTiers!: SalesTierDisplayDto[];
  @ApiProperty({ type: [PriceTierDisplayDto] })
  priceTiers!: PriceTierDisplayDto[];
}

export class CommissionProfileResponseDto {
  currency!: string;
  completedSalesCount!: number;
  currentTier!: SalesTierDisplayDto;
  @ApiPropertyOptional({ type: SalesTierDisplayDto, nullable: true })
  nextTier!: SalesTierDisplayDto | null;
  salesRemaining!: number | null;
  priceTiers!: PriceTierDisplayDto[];
  matrix!: CommissionMatrixRowDto[];
}
