import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ShipPaymentDto } from './ship-payment.dto';

describe('ShipPaymentDto', () => {
  it('trims values and converts blank strings to null', async () => {
    const dto = plainToInstance(ShipPaymentDto, {
      trackingNumber: '  ABC123  ',
      carrier: '   ',
    });

    expect(dto.trackingNumber).toBe('ABC123');
    expect(dto.carrier).toBeNull();
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('allows an empty body', async () => {
    await expect(
      validate(plainToInstance(ShipPaymentDto, {})),
    ).resolves.toHaveLength(0);
  });

  it('rejects values over their maximum lengths', async () => {
    const dto = plainToInstance(ShipPaymentDto, {
      trackingNumber: 'x'.repeat(121),
      carrier: 'x'.repeat(101),
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['trackingNumber', 'carrier']),
    );
  });
});
