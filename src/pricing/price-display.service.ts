import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExchangeRateService } from '../payments/exchange-rate/exchange-rate.service';
import {
  SupportedCurrency,
  USD_CURRENCY,
} from '../payments/exchange-rate/exchange-rate.constants';
import { computeFinalPrice } from '../products/product-pricing';
import { User } from '../users/entities/user.entity';
import {
  DEFAULT_DISPLAY_CURRENCY,
  UsdRates,
  parseSupportedCurrency,
  roundToCurrency,
} from './currency';

export interface PriceSource {
  price: number | null;
  discountPercent: number | null;
  currency: string | null;
}

// Campos que se agregan a cada producto. price, finalPrice y currency
// originales nunca se tocan.
export interface DisplayPriceFields {
  displayPrice: number | null;
  displayFinalPrice: number | null;
  displayCurrency: string;
  isConverted: boolean;
}

export type WithDisplayPrice<T> = T & DisplayPriceFields;

// Tras un fallo sin ningún snapshot (503) no se reintenta esa moneda durante
// este tiempo, para no consultar al proveedor en cada request.
const UNAVAILABLE_RETRY_MS = 60_000;

/**
 * Único punto de conversión de precios para mostrar. Convierte
 * origen → USD → destino con ExchangeRateService (venta del BCCR para CRC,
 * Frankfurter para el resto) y redondea a los decimales ISO 4217 de la moneda
 * destino. La conversión es informativa: el cobro sigue en la moneda original.
 */
@Injectable()
export class PriceDisplayService {
  private readonly logger = new Logger(PriceDisplayService.name);
  private readonly unavailableUntil = new Map<string, number>();

  constructor(
    private readonly exchangeRateService: ExchangeRateService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  // Header X-Display-Currency → user.displayCurrency → user.currency → CRC.
  // Un header inválido o no soportado se ignora.
  async resolveCurrency(
    header: unknown,
    userId: string | undefined,
  ): Promise<SupportedCurrency> {
    const fromHeader = parseSupportedCurrency(header);
    if (fromHeader) return fromHeader;

    if (userId) {
      const user = await this.usersRepository.findOne({
        where: { id: userId },
        select: { id: true, displayCurrency: true, currency: true },
      });
      const preferred =
        parseSupportedCurrency(user?.displayCurrency) ??
        parseSupportedCurrency(user?.currency);
      if (preferred) return preferred;
    }
    return DEFAULT_DISPLAY_CURRENCY;
  }

  // Una consulta por moneda distinta (no por producto); ExchangeRateService
  // las cachea en memoria y en exchange_rate_snapshot.
  async getUsdRates(
    currencies: Iterable<string | null | undefined>,
  ): Promise<UsdRates> {
    const wanted = new Set<SupportedCurrency>();
    for (const value of currencies) {
      const currency = parseSupportedCurrency(value);
      if (currency && currency !== USD_CURRENCY) wanted.add(currency);
    }

    const rates = new Map<string, number>([[USD_CURRENCY, 1]]);
    await Promise.all(
      [...wanted].map(async (currency) => {
        const rate = await this.fetchUsdRate(currency);
        if (rate !== null) rates.set(currency, rate);
      }),
    );
    return rates;
  }

  // Tasas para mostrar productos en `target`. Si todos ya están en esa moneda
  // no consulta ninguna.
  async getDisplayRates(
    target: string,
    currencies: (string | null | undefined)[],
  ): Promise<UsdRates> {
    const needsConversion = currencies.some((value) => {
      const currency = parseSupportedCurrency(value);
      return currency !== null && currency !== target;
    });
    return needsConversion
      ? this.getUsdRates([target, ...currencies])
      : new Map([[USD_CURRENCY, 1]]);
  }

  async withDisplayPrices<T extends PriceSource>(
    items: T[],
    target: string,
    rates?: UsdRates,
  ): Promise<WithDisplayPrice<T>[]> {
    if (items.length === 0) return [];
    const usdRates =
      rates ??
      (await this.getDisplayRates(
        target,
        items.map((item) => item.currency),
      ));
    return items.map((item) => ({
      ...item,
      ...this.toDisplay(item, target, usdRates),
    }));
  }

  toDisplay(
    item: PriceSource,
    target: string,
    rates: UsdRates,
  ): DisplayPriceFields {
    const unavailable: DisplayPriceFields = {
      displayPrice: null,
      displayFinalPrice: null,
      displayCurrency: target,
      isConverted: false,
    };
    const source = parseSupportedCurrency(item.currency);
    if (item.price == null || !source) return unavailable;

    const finalPrice = computeFinalPrice(item.price, item.discountPercent);
    if (source === target) {
      return {
        displayPrice: roundToCurrency(item.price, target),
        displayFinalPrice: roundToCurrency(finalPrice, target),
        displayCurrency: target,
        isConverted: false,
      };
    }

    const sourceRate = rates.get(source);
    const targetRate = rates.get(target);
    if (sourceRate === undefined || targetRate === undefined) {
      return unavailable;
    }
    // Mismo orden de operaciones que el SQL de filtros: a USD y luego al
    // destino.
    const convert = (amount: number) =>
      roundToCurrency((amount / sourceRate) * targetRate, target);
    return {
      displayPrice: convert(item.price),
      displayFinalPrice: convert(finalPrice),
      displayCurrency: target,
      isConverted: true,
    };
  }

  private async fetchUsdRate(currency: string): Promise<number | null> {
    const retryAt = this.unavailableUntil.get(currency);
    if (retryAt !== undefined && retryAt > Date.now()) return null;

    try {
      // Sin rateType: para USD↔CRC ExchangeRateService usa la venta del
      // BCCR, igual que GET /payments/quote.
      const quote = await this.exchangeRateService.getRate(
        USD_CURRENCY,
        currency,
      );
      this.unavailableUntil.delete(currency);
      return quote.rate;
    } catch (error: unknown) {
      this.unavailableUntil.set(currency, Date.now() + UNAVAILABLE_RETRY_MS);
      this.logger.warn(
        `Sin tasa USD→${currency}; se muestra solo el precio original (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      return null;
    }
  }
}
