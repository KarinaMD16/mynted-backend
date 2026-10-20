import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { ExchangeRateType } from '../enums/exchange-rate-type.enum';
import { costaRicaToday, subtractDays } from './date.utils';
import { ExchangeRateService } from './exchange-rate.service';

describe('ExchangeRateService', () => {
  const quote = {
    fromCurrency: 'USD',
    toCurrency: 'CRC',
    rate: 500,
    rateDate: '2026-10-19',
    source: 'BCCR',
    indicatorCode: 318,
    rateType: ExchangeRateType.SALE,
  };

  const config = { get: jest.fn(() => '1800000') } as unknown as ConfigService;
  const today = costaRicaToday();
  const yesterday = subtractDays(today, 1);
  const oldSnapshot = (
    rate = 500,
    rateDate = today,
    fetchedAt = new Date(),
  ) => ({
    id: 1,
    ...quote,
    rate,
    rateDate,
    fetchedAt,
  });

  function create(
    provider: { getRate: jest.Mock },
    snapshots: Record<string, jest.Mock>,
  ) {
    return new ExchangeRateService(
      provider,
      provider,
      snapshots as never,
      config,
    );
  }

  it('fetches, persists and caches a quote, then converts USD to CRC', async () => {
    const provider = { getRate: jest.fn().mockResolvedValue(quote) };
    const snapshots = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null),
      insert: jest.fn().mockResolvedValue(undefined),
    };
    const service = create(provider, snapshots);

    await expect(
      service.convert(10, 'USD', 'CRC', { date: '2026-10-19' }),
    ).resolves.toMatchObject({
      amount: 5000,
      currency: 'CRC',
      rateDate: '2026-10-19',
    });
    await service.getUsdCrcRate(ExchangeRateType.SALE, '2026-10-19');

    expect(provider.getRate).toHaveBeenCalledTimes(1);
    expect(snapshots.insert).toHaveBeenCalledTimes(1);
  });

  it('uses the latest persisted rate when BCCR is unavailable', async () => {
    const provider = {
      getRate: jest.fn().mockRejectedValue(new Error('network')),
    };
    const snapshots = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...quote, rateDate: '2026-10-18', rate: 499 }),
      insert: jest.fn(),
    };
    const service = create(provider, snapshots);

    await expect(
      service.getUsdCrcRate(ExchangeRateType.SALE, '2026-10-19'),
    ).resolves.toMatchObject({
      rate: 499,
      rateDate: '2026-10-18',
      fallback: true,
    });
  });

  it('returns 503 when neither BCCR nor a persisted fallback is available', async () => {
    const provider = {
      getRate: jest.fn().mockRejectedValue(new Error('network')),
    };
    const snapshots = {
      findOne: jest.fn().mockResolvedValue(null),
      insert: jest.fn(),
    };
    const service = create(provider, snapshots);

    await expect(
      service.getUsdCrcRate(ExchangeRateType.SALE, '2026-10-19'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('inverts CRC to USD and rejects unsupported currencies', async () => {
    const provider = { getRate: jest.fn().mockResolvedValue(quote) };
    const snapshots = {
      findOne: jest.fn().mockResolvedValue(oldSnapshot()),
      insert: jest.fn(),
      update: jest.fn(),
    };
    const service = create(provider, snapshots);

    await expect(
      service.convert(1000, 'CRC', 'USD', { date: '2026-10-19' }),
    ).resolves.toMatchObject({ amount: 2, currency: 'USD' });
    await expect(service.getRate('GBP', 'CRC')).rejects.toThrow(
      'Moneda no soportada',
    );
  });

  it('returns identity for CRC to CRC and USD to USD without the provider', async () => {
    const provider = { getRate: jest.fn() };
    const snapshots = {
      findOne: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
    };
    const service = create(provider, snapshots);

    await expect(
      service.getRate('CRC', 'CRC', { date: today }),
    ).resolves.toMatchObject({ rate: 1 });
    await expect(
      service.getRate('USD', 'USD', { date: today }),
    ).resolves.toMatchObject({ rate: 1 });
    expect(provider.getRate).not.toHaveBeenCalled();
  });

  it('uses SALE/318 by default and allows explicit PURCHASE/317', async () => {
    const provider = { getRate: jest.fn().mockResolvedValue(quote) };
    const snapshots = {
      findOne: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue(undefined),
      update: jest.fn(),
    };
    const service = create(provider, snapshots);

    await service.getRate('USD', 'CRC', { date: today });
    await service.getRate('USD', 'CRC', {
      rateType: ExchangeRateType.PURCHASE,
      date: yesterday,
    });

    expect(provider.getRate).toHaveBeenNthCalledWith(1, 'USD', 'CRC', {
      rateType: ExchangeRateType.SALE,
      date: today,
    });
    expect(provider.getRate).toHaveBeenNthCalledWith(2, 'USD', 'CRC', {
      rateType: ExchangeRateType.PURCHASE,
      date: yesterday,
    });
  });

  it('reuses an exact historical snapshot without calling BCCR', async () => {
    const provider = { getRate: jest.fn() };
    const snapshots = {
      findOne: jest
        .fn()
        .mockResolvedValue(oldSnapshot(499, yesterday, new Date(0))),
      insert: jest.fn(),
      update: jest.fn(),
    };
    const service = create(provider, snapshots);

    await expect(
      service.getUsdCrcRate(ExchangeRateType.SALE, yesterday),
    ).resolves.toMatchObject({ rate: 499, fallback: false });
    expect(provider.getRate).not.toHaveBeenCalled();
  });

  it('reuses a fresh exact snapshot for today', async () => {
    const provider = { getRate: jest.fn() };
    const snapshots = {
      findOne: jest.fn().mockResolvedValue(oldSnapshot(501, today, new Date())),
      insert: jest.fn(),
      update: jest.fn(),
    };
    const service = create(provider, snapshots);

    await expect(
      service.getUsdCrcRate(ExchangeRateType.SALE, today),
    ).resolves.toMatchObject({ rate: 501, fallback: false });
    expect(provider.getRate).not.toHaveBeenCalled();
  });

  it('refreshes an expired exact snapshot for today', async () => {
    const provider = {
      getRate: jest
        .fn()
        .mockResolvedValue({ ...quote, rate: 502, rateDate: today }),
    };
    const snapshots = {
      findOne: jest
        .fn()
        .mockResolvedValue(oldSnapshot(501, today, new Date(0))),
      insert: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const service = create(provider, snapshots);

    await expect(
      service.getUsdCrcRate(ExchangeRateType.SALE, today),
    ).resolves.toMatchObject({ rate: 502, fallback: false });
    expect(provider.getRate).toHaveBeenCalledTimes(1);
    expect(snapshots.update).toHaveBeenCalledWith(1, expect.anything());
  });

  it('uses an expired exact snapshot as fallback when today refresh fails', async () => {
    const provider = {
      getRate: jest.fn().mockRejectedValue(new Error('down')),
    };
    const snapshots = {
      findOne: jest
        .fn()
        .mockResolvedValue(oldSnapshot(501, today, new Date(0))),
      insert: jest.fn(),
      update: jest.fn(),
    };
    const service = create(provider, snapshots);

    await expect(
      service.getUsdCrcRate(ExchangeRateType.SALE, today),
    ).resolves.toMatchObject({ rate: 501, fallback: true });
  });

  it('updates an existing logical snapshot instead of inserting a duplicate', async () => {
    const provider = {
      getRate: jest
        .fn()
        .mockResolvedValue({ ...quote, rate: 503, rateDate: yesterday }),
    };
    const snapshots = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(oldSnapshot(499, yesterday)),
      insert: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const service = create(provider, snapshots);

    await service.getUsdCrcRate(ExchangeRateType.SALE, yesterday);
    expect(snapshots.insert).not.toHaveBeenCalled();
    expect(snapshots.update).toHaveBeenCalledTimes(1);
  });

  it('handles PostgreSQL unique violation by updating the concurrent snapshot', async () => {
    const provider = {
      getRate: jest
        .fn()
        .mockResolvedValue({ ...quote, rate: 504, rateDate: yesterday }),
    };
    const snapshots = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(oldSnapshot(499, yesterday)),
      insert: jest.fn().mockRejectedValue({ code: '23505' }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const service = create(provider, snapshots);

    await service.getUsdCrcRate(ExchangeRateType.SALE, yesterday);
    expect(snapshots.update).toHaveBeenCalledWith(1, expect.anything());
  });

  it('never uses a persisted fallback after the requested date', async () => {
    const provider = {
      getRate: jest.fn().mockRejectedValue(new Error('down')),
    };
    const snapshots = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null),
      insert: jest.fn(),
      update: jest.fn(),
    };
    const service = create(provider, snapshots);

    await expect(
      service.getUsdCrcRate(ExchangeRateType.SALE, yesterday),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('routes BCCR pairs and other supported pairs to different providers', async () => {
    const bccr = { getRate: jest.fn().mockResolvedValue(quote) };
    const frankfurter = {
      getRate: jest.fn().mockResolvedValue({
        fromCurrency: 'EUR',
        toCurrency: 'CRC',
        rate: 580,
        rateDate: today,
        source: 'FRANKFURTER',
        indicatorCode: null,
        rateType: ExchangeRateType.REFERENCE,
      }),
    };
    const snapshots = {
      findOne: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue(undefined),
      update: jest.fn(),
    };
    const service = new ExchangeRateService(
      bccr,
      frankfurter,
      snapshots as never,
      config,
    );

    await service.getRate('USD', 'CRC', { date: today });
    await service.getRate('EUR', 'CRC', { date: today });
    await service.getRate('CRC', 'EUR', { date: today });
    await service.getRate('EUR', 'EUR', { date: today });

    expect(bccr.getRate).toHaveBeenCalledWith('USD', 'CRC', {
      rateType: ExchangeRateType.SALE,
      date: today,
    });
    expect(frankfurter.getRate).toHaveBeenCalledWith('EUR', 'CRC', {
      rateType: ExchangeRateType.REFERENCE,
      date: today,
    });
    expect(frankfurter.getRate).toHaveBeenCalledTimes(2);
    expect(bccr.getRate).toHaveBeenCalledTimes(1);
  });

  it('does not cross-fallback between BCCR and Frankfurter snapshots', async () => {
    const bccr = {
      getRate: jest.fn().mockRejectedValue(new Error('down')),
    };
    const frankfurter = { getRate: jest.fn() };
    const snapshots = {
      findOne: jest
        .fn()
        .mockImplementation((options: { where: { source?: string } }) =>
          options.where.source === 'FRANKFURTER'
            ? {
                ...quote,
                source: 'FRANKFURTER',
                rateType: ExchangeRateType.REFERENCE,
                rateDate: yesterday,
              }
            : null,
        ),
      insert: jest.fn(),
      update: jest.fn(),
    };
    const service = new ExchangeRateService(
      bccr,
      frankfurter,
      snapshots as never,
      config,
    );

    await expect(
      service.getRate('USD', 'CRC', { date: yesterday }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(frankfurter.getRate).not.toHaveBeenCalled();
  });
});
