import {
  PaymentCardValidationCode,
  PaymentCardValidationError,
  detectCardBrand,
  isValidCvv,
  isValidExpiry,
  isValidLuhn,
  normalizeCardNumber,
} from './card-validation';
import { SimulatedPaymentGateway } from './simulated-payment.gateway';
import { PaymentFailureReason } from './payment-failure-reason.enum';

describe('card validation', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 9, 15, 12));
  });

  afterEach(() => jest.useRealTimers());

  it('normalizes spaces and hyphens without accepting other characters', () => {
    expect(normalizeCardNumber('4242 4242-4242 4242')).toBe('4242424242424242');
    expect(normalizeCardNumber('4242x4242')).toBe('4242x4242');
  });

  it('validates Luhn and rejects malformed input', () => {
    expect(isValidLuhn('4242424242424242')).toBe(true);
    expect(isValidLuhn('4242424242424241')).toBe(false);
    expect(isValidLuhn('4242x4242')).toBe(false);
    expect(isValidLuhn('')).toBe(false);
  });

  it.each([
    [0, 2027],
    [13, 2027],
    [10, 999],
    [10, 2025],
    [9, 2026],
  ])('rejects invalid or expired expiry %s/%s', (month, year) => {
    expect(isValidExpiry(month, year)).toBe(false);
  });

  it('accepts the current month and future expiry', () => {
    expect(isValidExpiry(10, 2026)).toBe(true);
    expect(isValidExpiry(11, 2026)).toBe(true);
    expect(isValidExpiry(1, 2027)).toBe(true);
  });

  it.each(['012', '1234'])('accepts CVV %s', (cvv) => {
    expect(isValidCvv(cvv)).toBe(true);
  });

  it.each(['12', '12345', '12a', '---'])('rejects CVV %s', (cvv) => {
    expect(isValidCvv(cvv)).toBe(false);
  });

  it.each([
    ['4242424242424242', 'visa'],
    ['5555555555554444', 'mastercard'],
    ['2221000000000009', 'mastercard'],
    ['6011111111111117', 'unknown'],
  ])('detects %s as %s', (number, brand) => {
    expect(detectCardBrand(number)).toBe(brand);
  });
});

describe('SimulatedPaymentGateway', () => {
  let gateway: SimulatedPaymentGateway;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 9, 15, 12));
    gateway = new SimulatedPaymentGateway();
  });

  afterEach(() => jest.useRealTimers());

  function card(cardNumber: string, cvv = '123') {
    return {
      cardNumber,
      expiryMonth: 10,
      expiryYear: 2027,
      cvv,
    };
  }

  async function charge(cardNumber: string, cvv = '123') {
    const resultPromise = gateway.charge({
      amount: 100,
      currency: 'CRC',
      card: card(cardNumber, cvv),
    });
    jest.advanceTimersByTime(1000);
    return resultPromise;
  }

  it('approves the approved fixture with reference, brand and last four', async () => {
    const result = await charge('4242 4242 4242 4242');

    expect(result).toMatchObject({
      approved: true,
      cardBrand: 'visa',
      cardLast4: '4242',
    });
    if (result.approved)
      expect(result.gatewayReference).toMatch(/^SIM-[A-F0-9]{6}$/);
    expect(JSON.stringify(result)).not.toContain('4242424242424242');
    expect(JSON.stringify(result)).not.toContain('123');
  });

  it.each([
    ['4000000000000002', PaymentFailureReason.CARD_DECLINED],
    ['4000000000009995', PaymentFailureReason.INSUFFICIENT_FUNDS],
    ['4000000000000069', PaymentFailureReason.EXPIRED_CARD],
  ])('returns controlled rejection %s', async (number, failureReason) => {
    await expect(charge(number)).resolves.toEqual({
      approved: false,
      failureReason,
    });
  });

  it('declines a valid Luhn card that is not a fixture', async () => {
    await expect(charge('5555555555554444')).resolves.toEqual({
      approved: false,
      failureReason: PaymentFailureReason.CARD_DECLINED,
    });
  });

  it('rejects invalid PAN without applying the simulated delay', async () => {
    const resultPromise = gateway.charge({
      amount: 100,
      currency: 'CRC',
      card: card('4242424242424241'),
    });

    await expect(resultPromise).rejects.toMatchObject({
      name: 'PaymentCardValidationError',
      code: PaymentCardValidationCode.INVALID_CARD_NUMBER,
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects expiry and CVV locally with safe errors', async () => {
    const expired = gateway.charge({
      amount: 100,
      currency: 'CRC',
      card: { ...card('4242424242424242'), expiryMonth: 9, expiryYear: 2026 },
    });
    await expect(expired).rejects.toBeInstanceOf(PaymentCardValidationError);
    await expect(expired).rejects.toMatchObject({
      code: PaymentCardValidationCode.INVALID_EXPIRY,
    });

    const invalidCvv = gateway.charge({
      amount: 100,
      currency: 'CRC',
      card: card('4242424242424242', '12'),
    });
    await expect(invalidCvv).rejects.toMatchObject({
      code: PaymentCardValidationCode.INVALID_CVV,
    });
  });

  it.each([
    [0, 'CRC'],
    [Number.NaN, 'CRC'],
    [Number.POSITIVE_INFINITY, 'CRC'],
    [100, ''],
  ])('rejects invalid gateway input %s/%s', async (amount, currency) => {
    await expect(
      gateway.charge({
        amount,
        currency,
        card: card('4242424242424242'),
      }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('applies the delay only after local validation', async () => {
    const resultPromise = gateway.charge({
      amount: 100,
      currency: 'CRC',
      card: card('4242424242424242'),
    });
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(999);
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(1);
    await expect(resultPromise).resolves.toMatchObject({ approved: true });
  });
});
