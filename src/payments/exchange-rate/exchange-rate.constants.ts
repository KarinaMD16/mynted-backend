export const EXCHANGE_RATE_PROVIDER = 'EXCHANGE_RATE_PROVIDER';
export const BCCR_EXCHANGE_RATE_PROVIDER = 'BCCR_EXCHANGE_RATE_PROVIDER';
export const FRANKFURTER_EXCHANGE_RATE_PROVIDER =
  'FRANKFURTER_EXCHANGE_RATE_PROVIDER';
export const BCCR_SOURCE = 'BCCR';
export const FRANKFURTER_SOURCE = 'FRANKFURTER';
export const USD_CURRENCY = 'USD';
export const CRC_CURRENCY = 'CRC';
export const SUPPORTED_CURRENCIES = [
  'AOA',
  'ARS',
  'BRL',
  'CHF',
  'CLP',
  'COP',
  'CRC',
  'EUR',
  'GTQ',
  'HNL',
  'KRW',
  'MXN',
  'MZN',
  'NIO',
  'PEN',
  'USD',
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function normalizeSupportedCurrency(value: string): string {
  return value.trim().toUpperCase();
}

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}
