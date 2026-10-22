import { ServiceUnavailableException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ExchangeRateService } from '../payments/exchange-rate/exchange-rate.service';
import { User } from '../users/entities/user.entity';
import { PriceDisplayService } from './price-display.service';

// Unidades por 1 USD (CRC sería la venta del BCCR).
const USD_RATES: Record<string, number> = {
  CRC: 500,
  EUR: 0.8,
  MXN: 20,
  CLP: 975.857,
  KRW: 1326.98,
};

describe('PriceDisplayService', () => {
  let service: PriceDisplayService;
  let getRate: jest.Mock;
  let findOne: jest.Mock;

  const product = (
    price: number,
    currency: string | null,
    discountPercent: number | null = null,
  ) => ({ id: 1, price, currency, discountPercent });

  beforeEach(() => {
    getRate = jest.fn((from: string, to: string) => {
      const rate = USD_RATES[to];
      if (from !== 'USD' || rate === undefined) {
        return Promise.reject(
          new ServiceUnavailableException(
            'No hay una tasa de cambio disponible temporalmente',
          ),
        );
      }
      return Promise.resolve({ rate });
    });
    findOne = jest.fn().mockResolvedValue(null);
    service = new PriceDisplayService(
      { getRate } as unknown as ExchangeRateService,
      { findOne } as unknown as Repository<User>,
    );
  });

  describe('withDisplayPrices', () => {
    it('misma moneda: no convierte ni consulta tasas', async () => {
      const [item] = await service.withDisplayPrices(
        [product(25000, 'CRC', 10)],
        'CRC',
      );

      expect(item).toMatchObject({
        price: 25000,
        currency: 'CRC',
        displayPrice: 25000,
        displayFinalPrice: 22500,
        displayCurrency: 'CRC',
        isConverted: false,
      });
      expect(getRate).not.toHaveBeenCalled();
    });

    it('convierte entre dos monedas pasando por USD sin tocar los originales', async () => {
      // 100 EUR → 125 USD → 2500 MXN; con 20 % de descuento 80 EUR → 2000 MXN.
      const [item] = await service.withDisplayPrices(
        [product(100, 'EUR', 20)],
        'MXN',
      );

      expect(item).toMatchObject({
        price: 100,
        currency: 'EUR',
        discountPercent: 20,
        displayPrice: 2500,
        displayFinalPrice: 2000,
        displayCurrency: 'MXN',
        isConverted: true,
      });
      expect(getRate).toHaveBeenCalledWith('USD', 'EUR');
      expect(getRate).toHaveBeenCalledWith('USD', 'MXN');
    });

    it('par con CRC: usa la tasa USD→CRC en ambos sentidos', async () => {
      const [fromUsd, fromCrc] = await service.withDisplayPrices(
        [product(10, 'USD'), product(5000, 'CRC')],
        'CRC',
      );
      expect(fromUsd).toMatchObject({ displayPrice: 5000, isConverted: true });
      expect(fromCrc).toMatchObject({ displayPrice: 5000, isConverted: false });

      const [toUsd] = await service.withDisplayPrices(
        [product(5000, 'CRC')],
        'USD',
      );
      expect(toUsd).toMatchObject({
        displayPrice: 10,
        displayCurrency: 'USD',
        isConverted: true,
      });
      // Sin rateType: ExchangeRateService aplica la venta del BCCR.
      expect(getRate).toHaveBeenCalledWith('USD', 'CRC');
    });

    it('consulta una tasa por moneda distinta, no por producto', async () => {
      await service.withDisplayPrices(
        [product(1, 'EUR'), product(2, 'EUR'), product(3, 'MXN')],
        'CRC',
      );

      expect(getRate).toHaveBeenCalledTimes(3);
      expect(getRate.mock.calls.map(([, to]) => to as string).sort()).toEqual([
        'CRC',
        'EUR',
        'MXN',
      ]);
    });

    it('sin tasa (503 sin snapshot): displayPrice null e isConverted false, sin romper', async () => {
      const [converted, unavailable] = await service.withDisplayPrices(
        [product(10, 'USD'), product(100, 'PEN')],
        'USD',
      );

      expect(converted).toMatchObject({ displayPrice: 10 });
      expect(unavailable).toMatchObject({
        price: 100,
        currency: 'PEN',
        displayPrice: null,
        displayFinalPrice: null,
        displayCurrency: 'USD',
        isConverted: false,
      });
    });

    it('no reintenta una moneda sin tasa durante el siguiente minuto', async () => {
      await service.withDisplayPrices([product(100, 'PEN')], 'USD');
      await service.withDisplayPrices([product(100, 'PEN')], 'USD');

      expect(getRate).toHaveBeenCalledTimes(1);
    });

    it('si la moneda destino no tiene tasa solo muestra los productos que ya están en ella', async () => {
      const [same, other] = await service.withDisplayPrices(
        [product(1500, 'PEN'), product(10, 'USD')],
        'PEN',
      );

      expect(same).toMatchObject({ displayPrice: 1500, isConverted: false });
      expect(other).toMatchObject({ displayPrice: null, isConverted: false });
    });

    it('redondea a los decimales ISO 4217 de la moneda destino', async () => {
      const [clp, krw, eur] = await Promise.all([
        service.withDisplayPrices([product(10, 'USD')], 'CLP'),
        service.withDisplayPrices([product(10, 'USD')], 'KRW'),
        service.withDisplayPrices([product(10.01, 'USD')], 'EUR'),
      ]);

      // 9758.57 CLP → 9759 (0 decimales); 13269.8 KRW → 13270.
      expect(clp[0].displayPrice).toBe(9759);
      expect(krw[0].displayPrice).toBe(13270);
      // 8.008 EUR → 8.01 (2 decimales).
      expect(eur[0].displayPrice).toBe(8.01);
    });

    it('un producto sin precio o sin moneda (borrador) no se convierte', async () => {
      const [draft] = await service.withDisplayPrices(
        [
          {
            price: null,
            currency: null,
            discountPercent: null,
          },
        ],
        'USD',
      );

      expect(draft).toMatchObject({
        displayPrice: null,
        displayFinalPrice: null,
        isConverted: false,
      });
    });
  });

  describe('resolveCurrency', () => {
    it('usa el header si es una moneda soportada (sin consultar al usuario)', async () => {
      await expect(service.resolveCurrency(' usd ', 'user-id')).resolves.toBe(
        'USD',
      );
      await expect(service.resolveCurrency(['brl'], undefined)).resolves.toBe(
        'BRL',
      );
      expect(findOne).not.toHaveBeenCalled();
    });

    it('ignora un header inválido o no soportado y sigue con displayCurrency del usuario', async () => {
      findOne.mockResolvedValue({ displayCurrency: 'EUR', currency: 'CRC' });

      await expect(service.resolveCurrency('XYZ', 'user-id')).resolves.toBe(
        'EUR',
      );
      await expect(service.resolveCurrency('JPY', 'user-id')).resolves.toBe(
        'EUR',
      );
      expect(findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-id' } }),
      );
    });

    it('sin displayCurrency usa la currency del usuario', async () => {
      findOne.mockResolvedValue({ displayCurrency: null, currency: 'MXN' });

      await expect(service.resolveCurrency(undefined, 'user-id')).resolves.toBe(
        'MXN',
      );
    });

    it('usuario sin ninguna moneda o visitante: CRC por defecto', async () => {
      findOne.mockResolvedValue({ displayCurrency: null, currency: null });

      await expect(service.resolveCurrency('', 'user-id')).resolves.toBe('CRC');
      await expect(service.resolveCurrency(undefined, undefined)).resolves.toBe(
        'CRC',
      );
    });
  });
});
