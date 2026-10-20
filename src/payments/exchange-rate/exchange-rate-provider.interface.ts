import { ExchangeRateType } from '../enums/exchange-rate-type.enum';

export interface ExchangeRateQuote {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  rateDate: string;
  source: string;
  indicatorCode: number | null;
  rateType: ExchangeRateType;
}

export interface ExchangeRateProvider {
  getRate(
    fromCurrency: string,
    toCurrency: string,
    options?: { rateType?: ExchangeRateType; date?: string },
  ): Promise<ExchangeRateQuote>;
}
