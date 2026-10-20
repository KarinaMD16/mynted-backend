import { ConfigService } from '@nestjs/config';
import { Injectable, Logger } from '@nestjs/common';
import { ExchangeRateType } from '../enums/exchange-rate-type.enum';
import { FRANKFURTER_SOURCE } from './exchange-rate.constants';
import { isIsoDate } from './date.utils';
import {
  ExchangeRateProvider,
  ExchangeRateQuote,
} from './exchange-rate-provider.interface';

interface FrankfurterResponse {
  date?: string;
  base?: string;
  quote?: string;
  rate?: number;
}

export class FrankfurterProviderError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'FrankfurterProviderError';
  }
}

@Injectable()
export class FrankfurterExchangeRateProvider implements ExchangeRateProvider {
  private readonly logger = new Logger(FrankfurterExchangeRateProvider.name);

  constructor(private readonly config: ConfigService) {}

  async getRate(
    fromCurrency: string,
    toCurrency: string,
    options: { rateType?: ExchangeRateType; date?: string } = {},
  ): Promise<ExchangeRateQuote> {
    const from = fromCurrency.trim().toUpperCase();
    const to = toCurrency.trim().toUpperCase();
    const requestedDate = options.date;
    if (requestedDate && !isIsoDate(requestedDate)) {
      throw new FrankfurterProviderError('La fecha debe usar YYYY-MM-DD');
    }

    const baseUrl = (
      this.config.get<string>('FRANKFURTER_BASE_URL') ??
      'https://api.frankfurter.dev'
    )
      .trim()
      .replace(/\/$/, '');
    const url = new URL(
      `/v2/rate/${from.toLowerCase()}/${to.toLowerCase()}`,
      `${baseUrl}/`,
    );
    if (requestedDate) url.searchParams.set('date', requestedDate);

    const payload = await this.fetchJson(url.toString());
    const responseFrom = payload.base?.trim().toUpperCase();
    const responseTo = payload.quote?.trim().toUpperCase();
    if (
      responseFrom !== from ||
      responseTo !== to ||
      !payload.date ||
      !isIsoDate(payload.date) ||
      typeof payload.rate !== 'number' ||
      !Number.isFinite(payload.rate) ||
      payload.rate <= 0
    ) {
      throw new FrankfurterProviderError(
        'Frankfurter devolvió una tasa inválida',
      );
    }

    if (requestedDate && payload.date > requestedDate) {
      throw new FrankfurterProviderError(
        'Frankfurter devolvió una fecha posterior a la solicitada',
      );
    }

    const rate = payload.rate;

    return {
      fromCurrency: from,
      toCurrency: to,
      rate,
      rateDate: payload.date,
      source: FRANKFURTER_SOURCE,
      indicatorCode: null,
      rateType: ExchangeRateType.REFERENCE,
    };
  }

  private async fetchJson(url: string): Promise<FrankfurterResponse> {
    const configured = Number(
      this.config.get<string>('FRANKFURTER_REQUEST_TIMEOUT_MS'),
    );
    const timeoutMs =
      Number.isFinite(configured) && configured > 0 ? configured : 8000;
    let lastError: unknown;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new FrankfurterProviderError(
            `Frankfurter respondió HTTP ${response.status}`,
            response.status >= 500,
          );
        }
        try {
          return (await response.json()) as FrankfurterResponse;
        } catch {
          throw new FrankfurterProviderError(
            'Frankfurter devolvió JSON inválido',
          );
        }
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof FrankfurterProviderError ? error.retryable : true;
        if (!retryable || attempt === 2) throw error;
        this.logger.warn(
          'Error temporal consultando Frankfurter; se reintentará una vez',
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new FrankfurterProviderError('Error consultando Frankfurter', true);
  }
}
