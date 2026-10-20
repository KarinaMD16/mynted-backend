/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CommissionTiersController } from './commission-tiers.controller';

describe('CommissionTiersController', () => {
  it('is public and delegates the normalized query to the catalog', async () => {
    const catalog = {
      getSalesTiers: jest.fn().mockResolvedValue([]),
      getPriceTiers: jest
        .fn()
        .mockResolvedValue({ tiers: [], approximate: false }),
    };
    const controller = new CommissionTiersController(catalog as never);
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      CommissionTiersController.prototype.getTiers,
    );
    expect(guards).toBeUndefined();
    await expect(controller.getTiers({ currency: 'CRC' })).resolves.toEqual({
      currency: 'CRC',
      salesTiers: [],
      priceTiers: [],
    });
    expect(catalog.getPriceTiers).toHaveBeenCalledWith('CRC');
  });
});
