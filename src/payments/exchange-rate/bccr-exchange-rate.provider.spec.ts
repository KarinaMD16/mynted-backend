import { ConfigService } from '@nestjs/config';
import { BccrExchangeRateProvider } from './bccr-exchange-rate.provider';
import { ExchangeRateType } from '../enums/exchange-rate-type.enum';

describe('BccrExchangeRateProvider', () => {
  const config = {
    get: jest.fn(
      (key: string) =>
        ({
          BCCR_TOKEN: 'test-token',
          BCCR_BASE_URL: 'https://bccr.test/api',
          BCCR_LOOKBACK_DAYS: '7',
          BCCR_REQUEST_TIMEOUT_MS: '1000',
        })[key],
    ),
  } as unknown as ConfigService;

  afterEach(() => jest.restoreAllMocks());

  it('maps purchase to 317 and selects the latest valid date regardless of order', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          estado: true,
          datos: [
            {
              series: [
                { fecha: '2026-10-18', valorDatoPorPeriodo: 447.2 },
                { fecha: '2026-10-19', valorDatoPorPeriodo: 448.31 },
                { fecha: '2026-10-20', valorDatoPorPeriodo: 999 },
              ],
            },
          ],
        }),
    } as Response);

    const result = await new BccrExchangeRateProvider(config).getUsdCrcRate(
      ExchangeRateType.PURCHASE,
      '2026-10-19',
    );

    expect(result).toMatchObject({
      rate: 448.31,
      rateDate: '2026-10-19',
      indicatorCode: 317,
      rateType: ExchangeRateType.PURCHASE,
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/indicadoresEconomicos/317/series?'),
      expect.any(Object),
    );
  });

  it('retries a server error once and does not retry an authentication error', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            estado: true,
            datos: [
              { series: [{ fecha: '2026-10-19', valorDatoPorPeriodo: 500 }] },
            ],
          }),
      } as Response);

    await expect(
      new BccrExchangeRateProvider(config).getUsdCrcRate(
        ExchangeRateType.SALE,
        '2026-10-19',
      ),
    ).resolves.toMatchObject({ rate: 500, indicatorCode: 318 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock
      .mockReset()
      .mockResolvedValue({ ok: false, status: 401 } as Response);
    await expect(
      new BccrExchangeRateProvider(config).getUsdCrcRate(
        ExchangeRateType.SALE,
        '2026-10-19',
      ),
    ).rejects.toThrow('autenticación');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, Number.NaN, 'not-a-number'])(
    'rejects unusable rate values: %p',
    async (value) => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            estado: true,
            datos: [
              { series: [{ fecha: '2026-10-19', valorDatoPorPeriodo: value }] },
            ],
          }),
      } as Response);

      await expect(
        new BccrExchangeRateProvider(config).getUsdCrcRate(
          ExchangeRateType.SALE,
          '2026-10-19',
        ),
      ).rejects.toThrow('tasa válida');
    },
  );

  it.each([
    ['estado false', { estado: false, datos: [] }],
    ['datos vacío', { estado: true, datos: [] }],
    ['datos no es array', { estado: true, datos: {} }],
    ['series no es array', { estado: true, datos: [{ series: {} }] }],
  ])('rejects invalid BCCR payload: %s', async (_name, payload) => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
    } as Response);

    await expect(
      new BccrExchangeRateProvider(config).getUsdCrcRate(
        ExchangeRateType.SALE,
        '2026-10-19',
      ),
    ).rejects.toThrow();
  });

  it('rejects invalid JSON without retrying', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('invalid json')),
    } as Response);

    await expect(
      new BccrExchangeRateProvider(config).getUsdCrcRate(
        ExchangeRateType.SALE,
        '2026-10-19',
      ),
    ).rejects.toThrow('JSON inválido');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])('does not retry HTTP %s', async (status) => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status,
    } as Response);

    await expect(
      new BccrExchangeRateProvider(config).getUsdCrcRate(
        ExchangeRateType.SALE,
        '2026-10-19',
      ),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a network error once', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            estado: true,
            datos: [
              { series: [{ fecha: '2026-10-19', valorDatoPorPeriodo: 500 }] },
            ],
          }),
      } as Response);

    await expect(
      new BccrExchangeRateProvider(config).getUsdCrcRate(
        ExchangeRateType.SALE,
        '2026-10-19',
      ),
    ).resolves.toMatchObject({ rate: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a timeout once', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            estado: true,
            datos: [
              { series: [{ fecha: '2026-10-19', valorDatoPorPeriodo: 500 }] },
            ],
          }),
      } as Response);

    await expect(
      new BccrExchangeRateProvider(config).getUsdCrcRate(
        ExchangeRateType.SALE,
        '2026-10-19',
      ),
    ).resolves.toMatchObject({ rate: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops after two failed attempts', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 503 } as Response);

    await expect(
      new BccrExchangeRateProvider(config).getUsdCrcRate(
        ExchangeRateType.SALE,
        '2026-10-19',
      ),
    ).rejects.toThrow('HTTP 503');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails safely when the token is absent without exposing a token', async () => {
    const noTokenConfig = {
      get: jest.fn((key: string) =>
        key === 'BCCR_BASE_URL' ? 'https://bccr.test/api' : undefined,
      ),
    } as unknown as ConfigService;

    await expect(
      new BccrExchangeRateProvider(noTokenConfig).getUsdCrcRate(
        ExchangeRateType.SALE,
        '2026-10-19',
      ),
    ).rejects.toThrow('no está configurado');
    await expect(
      new BccrExchangeRateProvider(noTokenConfig).getUsdCrcRate(
        ExchangeRateType.SALE,
        '2026-10-19',
      ),
    ).rejects.not.toThrow('Bearer');
  });
});
