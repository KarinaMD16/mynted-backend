export class QuoteCommissionDto {
  rate!: number;
  amount!: number;
  sellerNet!: number;
  salesTierName!: string;
  priceTierName!: string;
  salesDiscount!: number;
  priceDiscount!: number;
}

export class QuoteConvertedAmountDto {
  amount!: number;
  currency!: string;
  exchangeRate!: number;
  rateDate!: string;
}

export class QuoteResponseDto {
  productId!: number;
  amount!: number;
  currency!: string;
  convertedAmount?: QuoteConvertedAmountDto;
  commission?: QuoteCommissionDto;
}
