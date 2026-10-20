import { ApiProperty } from '@nestjs/swagger';

export class SalesSummaryPeriodDto {
  from!: string | null;
  to!: string | null;
}

export class SalesSummaryTotalsDto {
  gross!: number;
  commissions!: number;
  net!: number;
}

export class SalesSummaryBreakdownDto extends SalesSummaryTotalsDto {
  currency!: string;
  transactionCount!: number;
}

export class SalesSummaryResponseDto {
  @ApiProperty({ example: 'CRC' })
  currency!: string;
  period!: SalesSummaryPeriodDto;
  totals!: SalesSummaryTotalsDto;
  breakdown!: SalesSummaryBreakdownDto[];
  approximate!: boolean;
}
