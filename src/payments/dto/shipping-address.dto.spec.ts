import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ShippingAddressDto } from './shipping-address.dto';

const validAddress = {
  fullName: '  María López  ',
  phone: ' 88888888 ',
  country: ' cr ',
  province: ' San José ',
  city: ' San José ',
  line1: ' Avenida Central ',
  line2: '   ',
  postalCode: '',
  notes: null,
};

describe('ShippingAddressDto', () => {
  it('normalizes required fields, country and empty optional fields', async () => {
    const dto = plainToInstance(ShippingAddressDto, validAddress);

    expect(await validate(dto)).toEqual([]);
    expect(dto).toEqual({
      fullName: 'María López',
      phone: '88888888',
      country: 'CR',
      province: 'San José',
      city: 'San José',
      line1: 'Avenida Central',
      line2: null,
      postalCode: null,
      notes: null,
    });
  });

  it.each([
    ['missing fullName', { ...validAddress, fullName: undefined }],
    ['missing phone', { ...validAddress, phone: undefined }],
    ['invalid country', { ...validAddress, country: 'XXX' }],
    ['missing city', { ...validAddress, city: '' }],
    ['missing line1', { ...validAddress, line1: '' }],
    ['notes too long', { ...validAddress, notes: 'x'.repeat(501) }],
  ])('rejects %s', async (_name, value) => {
    const dto = plainToInstance(ShippingAddressDto, value);
    expect(await validate(dto)).not.toEqual([]);
  });
});
