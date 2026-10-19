export class AdminPaymentSummaryPeriodDto {
  from!: string | null;
  to!: string | null;
}

export class AdminPaymentSummaryGroupDto {
  currency!: string;
  transactionCount!: number;
  gross!: number;
  commissions!: number;
  sellerNet!: number;
}

export class AdminPaymentSummarySalesTierDto extends AdminPaymentSummaryGroupDto {
  salesTierName!: string;
}

export class AdminPaymentSummaryPriceTierDto extends AdminPaymentSummaryGroupDto {
  priceTierName!: string;
}

export class AdminPaymentSummaryResponseDto {
  period!: AdminPaymentSummaryPeriodDto;
  totalsByCurrency!: AdminPaymentSummaryGroupDto[];
  bySalesTier!: AdminPaymentSummarySalesTierDto[];
  byPriceTier!: AdminPaymentSummaryPriceTierDto[];
}
