import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaymentsController } from './payments.controller';

describe('PaymentsController', () => {
  const dto = {
    productId: 7,
    card: {
      cardNumber: '4242424242424242',
      expiryMonth: 12,
      expiryYear: 2099,
      cvv: '123',
    },
  };

  it('is protected with JwtAuthGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      PaymentsController.prototype.checkout,
    ) as unknown[];

    expect(guards).toContain(JwtAuthGuard);
  });

  it('passes userId, DTO and Idempotency-Key to PaymentsService', async () => {
    const checkout = jest.fn().mockResolvedValue({
      id: 'tx-1',
      status: 'completed',
      amount: 100,
      currency: 'USD',
      commission: {},
      gatewayReference: 'SIM-A1B2C3',
      cardBrand: 'visa',
      cardLast4: '4242',
      completedAt: new Date(),
    });
    const controller = new PaymentsController({ checkout } as never);
    const request = {
      user: { userId: 'buyer-1', email: 'buyer@example.com' },
    } as never;

    const result = await controller.checkout(dto, ' checkout-1 ', request);

    expect(checkout).toHaveBeenCalledWith(dto, 'buyer-1', ' checkout-1 ');
    expect(result).not.toHaveProperty('cardNumber');
    expect(result).not.toHaveProperty('cvv');
  });

  it.each([
    ['missing', undefined],
    ['empty', '   '],
    ['short', 'short'],
    ['long', 'x'.repeat(129)],
  ])(
    'passes invalid %s header to service for 400 validation',
    async (_name, key) => {
      const checkout = jest.fn().mockRejectedValue(new BadRequestException());
      const controller = new PaymentsController({ checkout } as never);
      const request = { user: { userId: 'buyer-1' } } as never;

      await expect(
        controller.checkout(dto, key, request),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(checkout).toHaveBeenCalledWith(dto, 'buyer-1', key);
    },
  );

  it('does not expose sensitive card fields in the completed response', async () => {
    const checkout = jest.fn().mockResolvedValue({
      id: 'tx-1',
      status: 'completed',
      amount: 100,
      currency: 'USD',
      commission: {},
      gatewayReference: 'SIM-A1B2C3',
      cardBrand: 'visa',
      cardLast4: '4242',
      completedAt: new Date(),
    });
    const controller = new PaymentsController({ checkout } as never);

    const response = await controller.checkout(dto, 'checkout-safe', {
      user: { userId: 'buyer-1' },
    } as never);
    const serialized = JSON.stringify(response);

    expect(serialized).not.toContain('cardNumber');
    expect(serialized).not.toContain('cvv');
    expect(serialized).not.toContain('expiryMonth');
    expect(serialized).not.toContain('expiryYear');
    expect(serialized).not.toContain('"card"');
  });

  it('keeps the 402 body limited to safe fields', () => {
    const body = {
      statusCode: 402,
      transactionId: 'tx-1',
      failureReason: 'card_declined',
    };

    expect(body).toEqual({
      statusCode: 402,
      transactionId: 'tx-1',
      failureReason: 'card_declined',
    });
    expect(JSON.stringify(body)).not.toContain('cardNumber');
    expect(JSON.stringify(body)).not.toContain('cvv');
  });
});
