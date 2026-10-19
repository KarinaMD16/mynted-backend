import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommissionTier } from '../entities/commission-tier.entity';
import { CommissionTierType } from '../enums/commission-tier-type.enum';
import { CommissionService } from './commission.service';

describe('CommissionService', () => {
  const config = (values: Record<string, string | undefined> = {}) =>
    ({
      get: jest.fn((key: string) => values[key]),
    }) as unknown as ConfigService;

  const tier = (
    name: string,
    discount: number,
    type: CommissionTierType,
    currency: string | null = null,
  ) =>
    ({
      id: 1,
      name,
      type,
      discount,
      currency,
      minValue: 0,
      maxValue: null,
      isActive: true,
    }) as CommissionTier;

  const create = (
    findOne: jest.Mock,
    exchangeRateService = { convert: jest.fn() },
    values: Record<string, string | undefined> = {},
  ) =>
    new CommissionService(
      { findOne } as never,
      exchangeRateService as never,
      config(values),
    );

  describe('getSalesTier', () => {
    it.each([
      [0, 'Bronce'],
      [9, 'Bronce'],
      [10, 'Plata'],
      [49, 'Plata'],
      [50, 'Oro'],
      [99, 'Oro'],
      [100, 'Platino'],
    ])('%s returns %s', async (count, name) => {
      const repository = {
        findOne: jest
          .fn()
          .mockResolvedValue(tier(name, 0, CommissionTierType.SALES)),
      };

      await expect(
        create(repository.findOne).getSalesTier(count),
      ).resolves.toMatchObject({ name });
      expect(repository.findOne).toHaveBeenCalled();
    });

    it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects invalid count %s',
      async (count) => {
        const findOne = jest.fn();
        await expect(
          create(findOne).getSalesTier(count),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(findOne).not.toHaveBeenCalled();
      },
    );

    it('throws when no active sales tier applies', async () => {
      await expect(
        create(jest.fn().mockResolvedValue(null)).getSalesTier(10),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getPriceTier', () => {
    it.each([
      [24999, 'Estándar'],
      [25000, 'Medio'],
      [99999, 'Medio'],
      [100000, 'Alto'],
      [249999, 'Alto'],
      [250000, 'Premium'],
    ])('resolves CRC %s as %s', async (amount, name) => {
      const repository = {
        findOne: jest
          .fn()
          .mockResolvedValueOnce(
            tier('configured', 0, CommissionTierType.PRICE, 'CRC'),
          )
          .mockResolvedValueOnce(
            tier(name, 0, CommissionTierType.PRICE, 'CRC'),
          ),
      };
      const exchange = { convert: jest.fn() };

      await expect(
        create(repository.findOne, exchange).getPriceTier(amount, ' crc '),
      ).resolves.toMatchObject({
        tier: { name },
        exchangeRate: null,
        normalizedAmountCrc: null,
      });
      expect(exchange.convert).not.toHaveBeenCalled();
    });

    it.each([
      [49, 'Estándar'],
      [50, 'Medio'],
      [199, 'Medio'],
      [200, 'Alto'],
      [499, 'Alto'],
      [500, 'Premium'],
    ])('resolves USD %s as %s without conversion', async (amount, name) => {
      const repository = {
        findOne: jest
          .fn()
          .mockResolvedValueOnce(
            tier('configured', 0, CommissionTierType.PRICE, 'USD'),
          )
          .mockResolvedValueOnce(
            tier(name, 0, CommissionTierType.PRICE, 'USD'),
          ),
      };
      const exchange = { convert: jest.fn() };

      await expect(
        create(repository.findOne, exchange).getPriceTier(amount, 'USD'),
      ).resolves.toMatchObject({
        tier: { name },
        exchangeRate: null,
        normalizedAmountCrc: null,
      });
      expect(exchange.convert).not.toHaveBeenCalled();
    });

    it('normalizes a currency without configured tiers to CRC', async () => {
      const repository = {
        findOne: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(
            tier('Medio', 0.005, CommissionTierType.PRICE, 'CRC'),
          ),
      };
      const exchange = {
        convert: jest.fn().mockResolvedValue({ amount: 26000, rate: 520 }),
      };

      await expect(
        create(repository.findOne, exchange).getPriceTier(50, 'eur'),
      ).resolves.toMatchObject({
        tier: { name: 'Medio' },
        exchangeRate: 520,
        normalizedAmountCrc: 26000,
      });
      expect(exchange.convert).toHaveBeenCalledWith(50, 'EUR', 'CRC');
    });

    it('does not normalize a configured currency with no active matching tier', async () => {
      const repository = {
        findOne: jest
          .fn()
          .mockResolvedValueOnce(
            tier('disabled', 0, CommissionTierType.PRICE, 'USD'),
          )
          .mockResolvedValueOnce(null),
      };
      const exchange = { convert: jest.fn() };

      await expect(
        create(repository.findOne, exchange).getPriceTier(50, 'USD'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(exchange.convert).not.toHaveBeenCalled();
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects invalid amount %s',
      async (amount) => {
        const findOne = jest.fn();
        await expect(
          create(findOne).getPriceTier(amount, 'CRC'),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(findOne).not.toHaveBeenCalled();
      },
    );

    it('rejects an empty currency', async () => {
      await expect(
        create(jest.fn()).getPriceTier(10, '  '),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('calculate', () => {
    const calculateWith = (
      salesDiscount: number,
      priceDiscount: number,
      amount = 120000,
      salesCount = 60,
      values: Record<string, string | undefined> = {
        COMMISSION_BASE_RATE: '0.05',
        COMMISSION_MIN_RATE: '0.02',
      },
    ) => {
      const repository = {
        findOne: jest
          .fn()
          .mockResolvedValueOnce(
            tier('Oro', salesDiscount, CommissionTierType.SALES),
          )
          .mockResolvedValueOnce(
            tier('configured', 0, CommissionTierType.PRICE, 'CRC'),
          )
          .mockResolvedValueOnce(
            tier('Alto', priceDiscount, CommissionTierType.PRICE, 'CRC'),
          ),
      };
      return create(
        repository.findOne,
        { convert: jest.fn() },
        values,
      ).calculate(amount, 'CRC', salesCount);
    };

    it('calculates the example Oro + Alto at 3%', async () => {
      await expect(calculateWith(0.01, 0.01)).resolves.toMatchObject({
        rate: 0.03,
        salesTier: 'Oro',
        priceTier: 'Alto',
        commissionAmount: 3600,
        sellerNet: 116400,
      });
    });

    it.each([
      [0, 0, 0.05],
      [0.005, 0.005, 0.04],
      [0.01, 0.01, 0.03],
      [0.015, 0.015, 0.02],
    ])(
      'applies discounts %s + %s and returns rate %s',
      async (sales, price, expected) => {
        await expect(calculateWith(sales, price, 100)).resolves.toMatchObject({
          rate: expected,
        });
      },
    );

    it('rounds commission first and derives seller net from it', async () => {
      await expect(calculateWith(0.02, 0, 123.45, 60)).resolves.toMatchObject({
        rate: 0.03,
        commissionAmount: 3.7,
        sellerNet: 119.75,
      });
    });

    it('uses defaults when commission config is absent', async () => {
      await expect(calculateWith(0, 0, 100, 0, {})).resolves.toMatchObject({
        rate: 0.05,
      });
    });

    it.each([
      { COMMISSION_BASE_RATE: 'NaN' },
      { COMMISSION_BASE_RATE: '1.1' },
      { COMMISSION_MIN_RATE: '-0.1' },
      { COMMISSION_MIN_RATE: '0.06', COMMISSION_BASE_RATE: '0.05' },
      { COMMISSION_BASE_RATE: '' },
    ])('rejects invalid commission config %p', async (values) => {
      await expect(calculateWith(0, 0, 100, 0, values)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('returns normalized amount and exchange rate for an unconfigured currency', async () => {
      const repository = {
        findOne: jest
          .fn()
          .mockResolvedValueOnce(tier('Oro', 0.01, CommissionTierType.SALES))
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(
            tier('Medio', 0.005, CommissionTierType.PRICE, 'CRC'),
          ),
      };
      const exchange = {
        convert: jest.fn().mockResolvedValue({ amount: 26000, rate: 520 }),
      };
      const service = create(repository.findOne, exchange);

      await expect(service.calculate(50, 'EUR', 60)).resolves.toMatchObject({
        exchangeRate: 520,
        normalizedAmountCrc: 26000,
      });
      expect(exchange.convert).toHaveBeenCalledWith(50, 'EUR', 'CRC');
    });
  });
});
