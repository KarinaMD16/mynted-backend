import { ConfigService } from '@nestjs/config';
import { ExchangeRateType } from '../enums/exchange-rate-type.enum';
import { FrankfurterExchangeRateProvider } from './frankfurter-exchange-rate.provider';

describe('FrankfurterExchangeRateProvider', () => {
  const config = {
    get: jest.fn(
      (key: string) =>
        ({
          FRANKFURTER_BASE_URL: 'https://api.frankfurter.test',
          FRANKFURTER_REQUEST_TIMEOUT_MS: '1000',
        })[key],
    ),
  } as unknown as ConfigService;

  afterEach(() => jest.restoreAllMocks());

  it('gets a historical EUR to CRC reference rate', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          date: '2026-10-19',
          base: 'EUR',
          quote: 'CRC',
          rate: 580.25,
        }),
    } as Response);

    await expect(
      new FrankfurterExchangeRateProvider(config).getRate(' eur ', 'crc', {
        date: '2026-10-20',
      }),
    ).resolves.toMatchObject({
      fromCurrency: 'EUR',
      toCurrency: 'CRC',
      rate: 580.25,
      rateDate: '2026-10-19',
      source: 'FRANKFURTER',
      indicatorCode: null,
      rateType: ExchangeRateType.REFERENCE,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.frankfurter.test/v2/rate/eur/crc?date=2026-10-20',
      expect.any(Object),
    );
  });

  it.each([400, 404, 422])(
    'does not retry permanent HTTP %s errors',
    async (status) => {
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({ ok: false, status } as Response);

      await expect(
        new FrankfurterExchangeRateProvider(config).getRate('EUR', 'USD'),
      ).rejects.toThrow(`HTTP ${status}`);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('retries a server error once', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            date: '2026-10-20',
            base: 'GBP',
            quote: 'USD',
            rate: 1.2,
          }),
      } as Response);

    await expect(
      new FrankfurterExchangeRateProvider(config).getRate('GBP', 'USD'),
    ).resolves.toMatchObject({ rate: 1.2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['invalid JSON', () => Promise.reject(new Error('invalid'))],
    [
      'zero rate',
      () =>
        Promise.resolve({
          date: '2026-10-20',
          base: 'EUR',
          quote: 'USD',
          rate: 0,
        }),
    ],
    [
      'negative rate',
      () =>
        Promise.resolve({
          date: '2026-10-20',
          base: 'EUR',
          quote: 'USD',
          rate: -1,
        }),
    ],
    [
      'wrong base',
      () =>
        Promise.resolve({
          date: '2026-10-20',
          base: 'USD',
          quote: 'EUR',
          rate: 1.1,
        }),
    ],
    [
      'wrong quote',
      () =>
        Promise.resolve({
          date: '2026-10-20',
          base: 'EUR',
          quote: 'GBP',
          rate: 1.1,
        }),
    ],
  ])('rejects %s', async (_name, json) => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json,
    } as Response);

    await expect(
      new FrankfurterExchangeRateProvider(config).getRate('EUR', 'USD'),
    ).rejects.toThrow();
  });

  it('retries a network failure once', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            date: '2026-10-20',
            base: 'MXN',
            quote: 'CRC',
            rate: 29,
          }),
      } as Response);

    await expect(
      new FrankfurterExchangeRateProvider(config).getRate('MXN', 'CRC'),
    ).resolves.toMatchObject({ rate: 29 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
