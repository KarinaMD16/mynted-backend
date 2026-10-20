import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { ExchangeRateSnapshot } from '../entities/exchange-rate-snapshot.entity';
import { ExchangeRateType } from '../enums/exchange-rate-type.enum';
import {
  BCCR_SOURCE,
  BCCR_EXCHANGE_RATE_PROVIDER,
  CRC_CURRENCY,
  FRANKFURTER_SOURCE,
  FRANKFURTER_EXCHANGE_RATE_PROVIDER,
  USD_CURRENCY,
  isSupportedCurrency,
  normalizeSupportedCurrency,
} from './exchange-rate.constants';
import { costaRicaToday, isIsoDate } from './date.utils';
import {
  ExchangeRateProvider,
  ExchangeRateQuote,
} from './exchange-rate-provider.interface';

export interface ExchangeRateResult extends ExchangeRateQuote {
  fromCache: boolean;
  fallback: boolean;
}

export interface ConvertResult {
  amount: number;
  currency: string;
  rate: number;
  rateDate: string;
  source: string;
  rateType: ExchangeRateType;
  fallback: boolean;
}

interface CachedRate {
  expiresAt: number;
  result: ExchangeRateResult;
}

interface PostgresErrorLike {
  code?: unknown;
  driverError?: { code?: unknown };
}

@Injectable()
export class ExchangeRateService {
  private readonly cache = new Map<string, CachedRate>();

  constructor(
    @Inject(BCCR_EXCHANGE_RATE_PROVIDER)
    private readonly bccrProvider: ExchangeRateProvider,
    @Inject(FRANKFURTER_EXCHANGE_RATE_PROVIDER)
    private readonly frankfurterProvider: ExchangeRateProvider,
    @InjectRepository(ExchangeRateSnapshot)
    private readonly snapshots: Repository<ExchangeRateSnapshot>,
    private readonly config: ConfigService,
  ) {}

  async getUsdCrcRate(
    rateType = ExchangeRateType.SALE,
    date = costaRicaToday(),
  ): Promise<ExchangeRateResult> {
    return this.getRate(USD_CURRENCY, CRC_CURRENCY, { rateType, date });
  }

  async getRate(
    fromCurrency: string,
    toCurrency: string,
    options: { rateType?: ExchangeRateType; date?: string } = {},
  ): Promise<ExchangeRateResult> {
    const from = this.normalizeCurrency(fromCurrency);
    const to = this.normalizeCurrency(toCurrency);
    const date = options.date ?? costaRicaToday();
    this.validateDate(date);

    if (from === to) {
      return {
        fromCurrency: from,
        toCurrency: to,
        rate: 1,
        rateDate: date,
        source: 'INTERNAL',
        indicatorCode: 0,
        rateType: options.rateType ?? ExchangeRateType.REFERENCE,
        fromCache: true,
        fallback: false,
      };
    }

    const isBccrPair =
      (from === USD_CURRENCY && to === CRC_CURRENCY) ||
      (from === CRC_CURRENCY && to === USD_CURRENCY);
    if (isBccrPair && options.rateType === ExchangeRateType.REFERENCE) {
      throw new BadRequestException('BCCR solo admite tasas purchase o sale');
    }
    const source = isBccrPair ? BCCR_SOURCE : FRANKFURTER_SOURCE;
    const rateType = isBccrPair
      ? (options.rateType ?? ExchangeRateType.SALE)
      : ExchangeRateType.REFERENCE;
    const providerFrom = isBccrPair ? USD_CURRENCY : from;
    const providerTo = isBccrPair ? CRC_CURRENCY : to;
    const key = this.cacheKey(source, from, to, rateType, date);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        ...this.adjustDirection(cached.result, from, to),
        fromCache: true,
      };
    }
    this.cache.delete(key);

    const exact = await this.findSnapshot(
      source,
      providerFrom,
      providerTo,
      rateType,
      date,
      true,
    );
    const today = costaRicaToday();
    const exactIsHistorical = date < today;
    const exactIsFresh = exact ? this.isFresh(exact, source) : false;
    if (exact && (exactIsHistorical || exactIsFresh)) {
      return this.cacheResult(
        key,
        this.snapshotToResult(exact, false),
        from,
        to,
      );
    }

    const provider = isBccrPair ? this.bccrProvider : this.frankfurterProvider;
    try {
      const quote = await provider.getRate(providerFrom, providerTo, {
        rateType,
        date,
      });
      await this.saveSnapshot(quote);
      return this.cacheResult(
        key,
        { ...quote, fromCache: false, fallback: false },
        from,
        to,
      );
    } catch {
      if (exact) {
        return this.cacheResult(
          key,
          this.snapshotToResult(exact, true),
          from,
          to,
        );
      }
      const fallback = await this.findSnapshot(
        source,
        providerFrom,
        providerTo,
        rateType,
        date,
        false,
      );
      if (fallback) {
        return this.cacheResult(
          key,
          this.snapshotToResult(fallback, true),
          from,
          to,
        );
      }
      throw new ServiceUnavailableException(
        'No hay una tasa de cambio disponible temporalmente',
      );
    }
  }

  async convert(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    options: { rateType?: ExchangeRateType; date?: string } = {},
  ): Promise<ConvertResult> {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new BadRequestException(
        'El monto debe ser un número mayor o igual que cero',
      );
    }
    const quote = await this.getRate(fromCurrency, toCurrency, options);
    return {
      amount: Math.round(amount * quote.rate * 100) / 100,
      currency: quote.toCurrency,
      rate: quote.rate,
      rateDate: quote.rateDate,
      source: quote.source,
      rateType: quote.rateType,
      fallback: quote.fallback,
    };
  }

  private normalizeCurrency(currency: string): string {
    if (typeof currency !== 'string' || currency.trim() === '') {
      throw new BadRequestException('La moneda es obligatoria');
    }
    const normalized = normalizeSupportedCurrency(currency);
    if (!isSupportedCurrency(normalized)) {
      throw new BadRequestException(`Moneda no soportada: ${currency}`);
    }
    return normalized;
  }

  private validateDate(date: string): void {
    if (!isIsoDate(date))
      throw new BadRequestException('La fecha debe usar YYYY-MM-DD');
  }

  private cacheKey(
    source: string,
    from: string,
    to: string,
    rateType: ExchangeRateType,
    date: string,
  ): string {
    return `${source}:${from}:${to}:${rateType.toUpperCase()}:${date}`;
  }

  private cacheResult(
    key: string,
    result: ExchangeRateResult,
    from: string,
    to: string,
  ): ExchangeRateResult {
    const source = result.source;
    const cacheTtlKey =
      source === FRANKFURTER_SOURCE
        ? 'FRANKFURTER_CACHE_TTL_MS'
        : 'BCCR_CACHE_TTL_MS';
    const configured = Number(this.config.get<string>(cacheTtlKey));
    const ttlMs =
      Number.isFinite(configured) && configured > 0 ? configured : 1_800_000;
    const adjusted = this.adjustDirection(result, from, to);
    this.cache.set(key, {
      result,
      expiresAt: Date.now() + ttlMs,
    });
    return adjusted;
  }

  private async findSnapshot(
    source: string,
    fromCurrency: string,
    toCurrency: string,
    rateType: ExchangeRateType,
    date: string,
    exact: boolean,
  ): Promise<ExchangeRateSnapshot | null> {
    return this.snapshots.findOne({
      where: {
        source,
        fromCurrency,
        toCurrency,
        rateType,
        rateDate: exact ? date : LessThanOrEqual(date),
      },
      order: { rateDate: 'DESC', fetchedAt: 'DESC' },
    });
  }

  private async saveSnapshot(quote: ExchangeRateQuote): Promise<void> {
    const existing = await this.snapshots.findOne({
      where: {
        source: quote.source,
        fromCurrency: quote.fromCurrency,
        toCurrency: quote.toCurrency,
        rateType: quote.rateType,
        rateDate: quote.rateDate,
      },
    });
    if (existing) {
      await this.updateSnapshot(existing, quote);
      return;
    }
    try {
      await this.snapshots.insert({ ...quote });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const concurrent = await this.snapshots.findOne({
        where: {
          source: quote.source,
          fromCurrency: quote.fromCurrency,
          toCurrency: quote.toCurrency,
          rateType: quote.rateType,
          rateDate: quote.rateDate,
        },
      });
      if (concurrent) await this.updateSnapshot(concurrent, quote);
    }
  }

  private async updateSnapshot(
    existing: ExchangeRateSnapshot,
    quote: ExchangeRateQuote,
  ): Promise<void> {
    await this.snapshots.update(existing.id, {
      ...quote,
      fetchedAt: new Date(),
    });
  }

  private isFresh(snapshot: ExchangeRateSnapshot, source: string): boolean {
    if (!(snapshot.fetchedAt instanceof Date)) return false;
    const key =
      source === FRANKFURTER_SOURCE
        ? 'FRANKFURTER_CACHE_TTL_MS'
        : 'BCCR_CACHE_TTL_MS';
    const configured = Number(this.config.get<string>(key));
    const ttlMs =
      Number.isFinite(configured) && configured > 0 ? configured : 1_800_000;
    return snapshot.fetchedAt.getTime() + ttlMs > Date.now();
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as PostgresErrorLike;
    return (
      candidate.code === '23505' || candidate.driverError?.code === '23505'
    );
  }

  private snapshotToResult(
    snapshot: ExchangeRateSnapshot,
    fallback: boolean,
  ): ExchangeRateResult {
    return {
      fromCurrency: snapshot.fromCurrency,
      toCurrency: snapshot.toCurrency,
      rate: snapshot.rate,
      rateDate: snapshot.rateDate,
      source: snapshot.source,
      indicatorCode: snapshot.indicatorCode,
      rateType: snapshot.rateType,
      fromCache: false,
      fallback,
    };
  }

  private adjustDirection(
    result: ExchangeRateResult,
    from: string,
    to: string,
  ): ExchangeRateResult {
    if (result.fromCurrency === from && result.toCurrency === to) {
      return { ...result };
    }
    return {
      ...result,
      fromCurrency: from,
      toCurrency: to,
      rate: 1 / result.rate,
    };
  }
}
