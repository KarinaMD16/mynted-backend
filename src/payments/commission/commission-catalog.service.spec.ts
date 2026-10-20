/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException } from '@nestjs/common';
import { CommissionCatalogService } from './commission-catalog.service';
import { CommissionTierType } from '../enums/commission-tier-type.enum';

describe('CommissionCatalogService', () => {
  const tier = (overrides = {}) => ({
    id: 1,
    type: CommissionTierType.PRICE,
    name: 'Estándar',
    minValue: 0,
    maxValue: 25000,
    currency: 'CRC',
    discount: 0,
    isActive: true,
    ...overrides,
  });

  const create = (findMock: jest.Mock) => {
    const exchangeRateService = {
      getRate: jest.fn().mockResolvedValue({ rate: 0.002 }),
    };
    const commissionService = {
      calculateRate: jest.fn((salesDiscount: number, priceDiscount: number) =>
        Math.max(0.05 - salesDiscount - priceDiscount, 0.02),
      ),
    };
    const service = new CommissionCatalogService(
      { find: findMock } as never,
      exchangeRateService as never,
      commissionService as never,
    );
    return { service, exchangeRateService, commissionService };
  };

  it('loads active sales tiers ordered by minValue', async () => {
    const find = jest.fn().mockResolvedValue([]);
    const h = create(find);
    await h.service.getSalesTiers();
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ order: { minValue: 'ASC' } }),
    );
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: CommissionTierType.SALES,
          isActive: true,
        }),
      }),
    );
  });

  it('uses active own price tiers without conversion', async () => {
    const find = jest
      .fn()
      .mockResolvedValue([
        tier({ currency: 'USD', minValue: 0, maxValue: null }),
      ]);
    const h = create(find);
    const result = await h.service.getPriceTiers(' usd ');
    expect(result).toMatchObject({ approximate: false });
    expect(result.tiers[0]).toMatchObject({ currency: 'USD', maxValue: null });
    expect(h.exchangeRateService.getRate).not.toHaveBeenCalled();
  });

  it('falls back to CRC once and preserves open maxValue', async () => {
    const find = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        tier({ minValue: 0, maxValue: 25000 }),
        tier({ name: 'Premium', minValue: 250000, maxValue: null }),
      ]);
    const h = create(find);
    const result = await h.service.getPriceTiers('USD');
    expect(result.approximate).toBe(true);
    expect(result.tiers).toEqual([
      expect.objectContaining({
        minValue: 0,
        maxValue: 50,
        currency: 'USD',
        approximate: true,
      }),
      expect.objectContaining({ minValue: 500, maxValue: null }),
    ]);
    expect(h.exchangeRateService.getRate).toHaveBeenCalledTimes(1);
    expect(h.exchangeRateService.getRate).toHaveBeenCalledWith('CRC', 'USD');
  });

  it('builds the complete matrix through CommissionService', () => {
    const h = create(jest.fn());
    const matrix = h.service.buildMatrix(
      [
        tier({ type: CommissionTierType.SALES, name: 'Bronce', discount: 0 }),
        tier({
          type: CommissionTierType.SALES,
          name: 'Platino',
          discount: 0.015,
        }),
      ] as never,
      [
        {
          name: 'Estándar',
          minValue: 0,
          maxValue: 10,
          discount: 0,
          currency: 'CRC',
          approximate: false,
        },
        {
          name: 'Premium',
          minValue: 10,
          maxValue: null,
          discount: 0.015,
          currency: 'CRC',
          approximate: false,
        },
      ],
    );
    expect(matrix).toHaveLength(2);
    expect(matrix[0].rates[0].commissionRate).toBe(0.05);
    expect(matrix[1].rates[1].commissionRate).toBeCloseTo(0.02, 10);
    expect(h.commissionService.calculateRate).toHaveBeenCalledTimes(4);
  });

  it('propagates unsupported currency errors', async () => {
    const find = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const h = create(find);
    h.exchangeRateService.getRate.mockRejectedValue(
      new BadRequestException('Moneda no soportada'),
    );
    await expect(h.service.getPriceTiers('EUR')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
