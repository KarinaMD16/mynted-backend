import { ExchangeRateType } from '../enums/exchange-rate-type.enum';

export interface ExchangeRateQuote {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  rateDate: string;
  source: string;
  indicatorCode: number;
  rateType: ExchangeRateType;
}

export interface ExchangeRateProvider {
  getUsdCrcRate(
    rateType: ExchangeRateType,
    date?: string,
  ): Promise<ExchangeRateQuote>;
}
