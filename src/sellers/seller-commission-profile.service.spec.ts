import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SellersService } from './sellers.service';

describe('SellersService.getCommissionProfile', () => {
  const tiers = [
    { name: 'Bronce', minValue: 0, maxValue: 10, discount: 0 },
    { name: 'Plata', minValue: 10, maxValue: 50, discount: 0.005 },
    { name: 'Oro', minValue: 50, maxValue: 100, discount: 0.01 },
    { name: 'Platino', minValue: 100, maxValue: null, discount: 0.015 },
  ];

  const create = (count: number, currency: string | null = 'CRC') => {
    const seller = {
      sellerId: 1,
      userId: 'seller-1',
      completedSalesCount: count,
    };
    const sellerRepository = { findOne: jest.fn().mockResolvedValue(seller) };
    const usersService = {
      findById: jest.fn().mockResolvedValue({ currency }),
    };
    const commissionService = { calculate: jest.fn() };
    const catalog = {
      getSalesTiers: jest.fn().mockResolvedValue(tiers),
      getPriceTiers: jest.fn().mockResolvedValue({
        approximate: false,
        tiers: [
          {
            name: 'Estándar',
            minValue: 0,
            maxValue: 25000,
            discount: 0,
            currency: 'CRC',
            approximate: false,
          },
        ],
      }),
      buildMatrix: jest
        .fn()
        .mockResolvedValue([{ salesTierName: 'Bronce', rates: [] }]),
    };
    const service = new SellersService(
      sellerRepository as never,
      usersService as never,
      commissionService as never,
      { transaction: jest.fn() } as never,
      undefined,
      catalog as never,
    );
    return { service, seller, sellerRepository, catalog };
  };

  it.each([
    [0, 'Bronce', 'Plata', 10],
    [9, 'Bronce', 'Plata', 1],
    [10, 'Plata', 'Oro', 40],
    [49, 'Plata', 'Oro', 1],
    [50, 'Oro', 'Platino', 50],
    [99, 'Oro', 'Platino', 1],
  ])(
    'resolves current/next tier at %s sales',
    async (count, current, next, remaining) => {
      const h = create(count);
      const result = await h.service.getCommissionProfile('seller-1');
      expect(result.currentTier.name).toBe(current);
      expect(result.nextTier?.name).toBe(next);
      expect(result.salesRemaining).toBe(remaining);
      expect(h.seller.completedSalesCount).toBe(count);
    },
  );

  it('returns null next tier at Platino and builds the matrix', async () => {
    const h = create(150);
    const result = await h.service.getCommissionProfile('seller-1');
    expect(result.currentTier.name).toBe('Platino');
    expect(result.nextTier).toBeNull();
    expect(result.salesRemaining).toBeNull();
    expect(h.catalog.buildMatrix).toHaveBeenCalled();
  });

  it.each([null, '', '   '])(
    'rejects missing currency: %p',
    async (currency) => {
      const h = create(1, currency);
      await expect(
        h.service.getCommissionProfile('seller-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(h.catalog.getSalesTiers).not.toHaveBeenCalled();
    },
  );

  it('rejects a missing seller', async () => {
    const h = create(1);
    h.sellerRepository.findOne.mockResolvedValue(null);
    await expect(
      h.service.getCommissionProfile('seller-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
