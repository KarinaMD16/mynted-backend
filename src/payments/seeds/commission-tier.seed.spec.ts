import { Repository } from 'typeorm';
import { CommissionTier } from '../entities/commission-tier.entity';
import {
  CommissionTierSeed,
  INITIAL_COMMISSION_TIERS,
} from './commission-tier.seed';
import { CommissionTierType } from '../enums/commission-tier-type.enum';

describe('CommissionTierSeed', () => {
  it('creates the twelve initial tiers when the table is empty', async () => {
    let inserted: Array<Partial<CommissionTier>> = [];
    const insert = jest.fn((values: Array<Partial<CommissionTier>>) => {
      inserted = values;
    });
    const repository = {
      count: jest.fn().mockResolvedValue(0),
      insert,
    } as unknown as Repository<CommissionTier>;

    await new CommissionTierSeed(repository).onApplicationBootstrap();

    expect(insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'sales',
          name: 'Bronce',
          minValue: 0,
          maxValue: 10,
          currency: null,
          discount: 0,
          isActive: true,
        }),
        expect.objectContaining({
          type: 'price',
          name: 'Premium',
          currency: 'USD',
          maxValue: null,
          discount: 0.015,
        }),
      ]),
    );

    expect(inserted).toHaveLength(12);
    expect(
      inserted.filter((tier) => tier.type === CommissionTierType.SALES),
    ).toHaveLength(4);
    expect(inserted.filter((tier) => tier.currency === 'CRC')).toHaveLength(4);
    expect(inserted.filter((tier) => tier.currency === 'USD')).toHaveLength(4);
    expect(INITIAL_COMMISSION_TIERS).toHaveLength(12);
  });

  it('does not overwrite existing administrative configuration', async () => {
    const insert = jest.fn();
    const repository = {
      count: jest.fn().mockResolvedValue(12),
      insert,
    } as unknown as Repository<CommissionTier>;

    await new CommissionTierSeed(repository).onApplicationBootstrap();

    expect(insert).not.toHaveBeenCalled();
  });
});
