export enum PaymentCardValidationCode {
  INVALID_CARD_NUMBER = 'INVALID_CARD_NUMBER',
  INVALID_EXPIRY = 'INVALID_EXPIRY',
  INVALID_CVV = 'INVALID_CVV',
}

export class PaymentCardValidationError extends Error {
  constructor(readonly code: PaymentCardValidationCode) {
    super(code);
    this.name = 'PaymentCardValidationError';
  }
}

export function normalizeCardNumber(cardNumber: string): string {
  return typeof cardNumber === 'string' ? cardNumber.replace(/[ -]/g, '') : '';
}

export function isValidLuhn(cardNumber: string): boolean {
  if (typeof cardNumber !== 'string' || !/^\d+$/.test(cardNumber)) return false;

  let sum = 0;
  let doubleDigit = false;
  for (let index = cardNumber.length - 1; index >= 0; index -= 1) {
    let digit = Number(cardNumber[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

export function isValidExpiry(
  expiryMonth: number,
  expiryYear: number,
  current: { month: number; year: number } = getCurrentMonth(),
): boolean {
  if (!Number.isInteger(expiryMonth) || expiryMonth < 1 || expiryMonth > 12) {
    return false;
  }
  if (!Number.isInteger(expiryYear) || expiryYear < 1000 || expiryYear > 9999) {
    return false;
  }
  return (
    expiryYear > current.year ||
    (expiryYear === current.year && expiryMonth >= current.month)
  );
}

export function isValidCvv(cvv: string): boolean {
  return typeof cvv === 'string' && /^\d{3,4}$/.test(cvv);
}

export function detectCardBrand(cardNumber: string): string {
  if (cardNumber.startsWith('4')) return 'visa';

  const firstTwo = Number(cardNumber.slice(0, 2));
  const firstFour = Number(cardNumber.slice(0, 4));
  if (
    (firstTwo >= 51 && firstTwo <= 55) ||
    (firstFour >= 2221 && firstFour <= 2720)
  ) {
    return 'mastercard';
  }
  return 'unknown';
}

function getCurrentMonth(): { month: number; year: number } {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}
