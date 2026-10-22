import {
  SupportedCurrency,
  isSupportedCurrency,
  normalizeSupportedCurrency,
} from '../payments/exchange-rate/exchange-rate.constants';

// Unidades de cada moneda por 1 USD. Una moneda sin tasa no aparece.
export type UsdRates = ReadonlyMap<string, number>;

export const DISPLAY_CURRENCY_HEADER = 'x-display-currency';
export const DEFAULT_DISPLAY_CURRENCY: SupportedCurrency = 'CRC';

// Código soportado o null. Acepta el valor crudo de un header (string o
// string[]) o de una columna; nunca lanza.
export function parseSupportedCurrency(
  value: unknown,
): SupportedCurrency | null {
  const raw = Array.isArray(value) ? (value[0] as unknown) : value;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const currency = normalizeSupportedCurrency(raw);
  return isSupportedCurrency(currency) ? currency : null;
}

const fractionDigitsCache = new Map<string, number>();

// Decimales ISO 4217 de la moneda (0 para CLP y KRW, 2 para el resto de las
// soportadas), según el ICU de Node.
export function currencyFractionDigits(currency: string): number {
  let digits = fractionDigitsCache.get(currency);
  if (digits === undefined) {
    try {
      digits =
        new Intl.NumberFormat('en', {
          style: 'currency',
          currency,
        }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      digits = 2;
    }
    fractionDigitsCache.set(currency, digits);
  }
  return digits;
}

export function roundToCurrency(amount: number, currency: string): number {
  const factor = 10 ** currencyFractionDigits(currency);
  return Math.round(amount * factor) / factor;
}
