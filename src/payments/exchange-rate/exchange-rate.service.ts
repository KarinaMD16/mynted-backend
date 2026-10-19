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
  CRC_CURRENCY,
  EXCHANGE_RATE_PROVIDER,
  USD_CURRENCY,
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
    @Inject(EXCHANGE_RATE_PROVIDER)
    private readonly provider: ExchangeRateProvider,
    @InjectRepository(ExchangeRateSnapshot)
    private readonly snapshots: Repository<ExchangeRateSnapshot>,
    private readonly config: ConfigService,
  ) {}

  async getUsdCrcRate(
    rateType = ExchangeRateType.SALE,
    date = costaRicaToday(),
  ): Promise<ExchangeRateResult> {
    this.validateDate(date);
    const key = this.cacheKey(rateType, date);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now())
      return { ...cached.result, fromCache: true };
    this.cache.delete(key);

    const exact = await this.findSnapshot(rateType, date, true);
    const today = costaRicaToday();
    const exactIsHistorical = date < today;
    const exactIsFresh = exact ? this.isFresh(exact) : false;
    if (exact && (exactIsHistorical || exactIsFresh))
      return this.cacheResult(key, this.snapshotToResult(exact, false));

    try {
      const quote = await this.provider.getUsdCrcRate(rateType, date);
      await this.saveSnapshot(quote);
      return this.cacheResult(key, {
        ...quote,
        fromCache: false,
        fallback: false,
      });
    } catch {
      if (exact)
        return this.cacheResult(key, this.snapshotToResult(exact, true));
      const fallback = await this.findSnapshot(rateType, date, false);
      if (fallback)
        return this.cacheResult(key, this.snapshotToResult(fallback, true));
      throw new ServiceUnavailableException(
        'No hay una tasa de cambio disponible temporalmente',
      );
    }
  }

  async getRate(
    fromCurrency: string,
    toCurrency: string,
    options: { rateType?: ExchangeRateType; date?: string } = {},
  ): Promise<ExchangeRateResult> {
    const from = this.normalizeCurrency(fromCurrency);
    const to = this.normalizeCurrency(toCurrency);
    if (from === USD_CURRENCY && to === CRC_CURRENCY) {
      return this.getUsdCrcRate(
        options.rateType ?? ExchangeRateType.SALE,
        options.date ?? costaRicaToday(),
      );
    }
    if (from === CRC_CURRENCY && to === USD_CURRENCY) {
      const base = await this.getUsdCrcRate(
        options.rateType ?? ExchangeRateType.SALE,
        options.date ?? costaRicaToday(),
      );
      return {
        ...base,
        fromCurrency: CRC_CURRENCY,
        toCurrency: USD_CURRENCY,
        rate: 1 / base.rate,
      };
    }
    if (from === to) {
      const date = options.date ?? costaRicaToday();
      this.validateDate(date);
      return {
        fromCurrency: from,
        toCurrency: to,
        rate: 1,
        rateDate: date,
        source: 'INTERNAL',
        indicatorCode: 0,
        rateType: options.rateType ?? ExchangeRateType.SALE,
        fromCache: true,
        fallback: false,
      };
    }
    throw new BadRequestException(
      'Solo se admiten conversiones entre USD y CRC',
    );
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
    const normalized = currency.trim().toUpperCase();
    if (normalized !== USD_CURRENCY && normalized !== CRC_CURRENCY) {
      throw new BadRequestException(`Moneda no soportada: ${currency}`);
    }
    return normalized;
  }

  private validateDate(date: string): void {
    if (!isIsoDate(date))
      throw new BadRequestException('La fecha debe usar YYYY-MM-DD');
  }

  private cacheKey(rateType: ExchangeRateType, date: string): string {
    return `${USD_CURRENCY}:${CRC_CURRENCY}:${rateType}:${date}`;
  }

  private cacheResult(
    key: string,
    result: ExchangeRateResult,
  ): ExchangeRateResult {
    const ttl = Number(this.config.get<string>('BCCR_CACHE_TTL_MS'));
    const ttlMs = Number.isFinite(ttl) && ttl > 0 ? ttl : 1_800_000;
    this.cache.set(key, { result, expiresAt: Date.now() + ttlMs });
    return result;
  }

  private async findSnapshot(
    rateType: ExchangeRateType,
    date: string,
    exact: boolean,
  ): Promise<ExchangeRateSnapshot | null> {
    return this.snapshots.findOne({
      where: {
        fromCurrency: USD_CURRENCY,
        toCurrency: CRC_CURRENCY,
        rateType,
        rateDate: exact ? date : LessThanOrEqual(date),
      },
      order: { rateDate: 'DESC', fetchedAt: 'DESC' },
    });
  }

  private async saveSnapshot(quote: ExchangeRateQuote): Promise<void> {
    const existing = await this.snapshots.findOne({
      where: {
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

  private isFresh(snapshot: ExchangeRateSnapshot): boolean {
    if (!(snapshot.fetchedAt instanceof Date)) return false;
    const ttl = Number(this.config.get<string>('BCCR_CACHE_TTL_MS'));
    const ttlMs = Number.isFinite(ttl) && ttl > 0 ? ttl : 1_800_000;
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
      fromCurrency: 'USD',
      toCurrency: 'CRC',
      rate: snapshot.rate,
      rateDate: snapshot.rateDate,
      source: snapshot.source,
      indicatorCode: snapshot.indicatorCode,
      rateType: snapshot.rateType,
      fromCache: false,
      fallback,
    };
  }
}
