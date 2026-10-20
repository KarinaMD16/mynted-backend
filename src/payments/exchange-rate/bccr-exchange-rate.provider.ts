import { ConfigService } from '@nestjs/config';
import { Injectable, Logger } from '@nestjs/common';
import { ExchangeRateType } from '../enums/exchange-rate-type.enum';
import {
  BCCR_SOURCE,
  CRC_CURRENCY,
  USD_CURRENCY,
} from './exchange-rate.constants';
import { costaRicaToday, isIsoDate, subtractDays } from './date.utils';
import {
  ExchangeRateProvider,
  ExchangeRateQuote,
} from './exchange-rate-provider.interface';

interface BccrSeriesEntry {
  fecha?: string;
  valorDatoPorPeriodo?: number | string | null;
}

interface BccrIndicatorData {
  series?: BccrSeriesEntry[];
}

interface BccrResponse {
  estado?: boolean;
  mensaje?: string;
  datos?: BccrIndicatorData[];
}

export class BccrProviderError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'BccrProviderError';
  }
}

@Injectable()
export class BccrExchangeRateProvider implements ExchangeRateProvider {
  private readonly logger = new Logger(BccrExchangeRateProvider.name);
  private readonly indicatorCodes: Record<
    Exclude<ExchangeRateType, ExchangeRateType.REFERENCE>,
    number
  > = {
    [ExchangeRateType.PURCHASE]: 317,
    [ExchangeRateType.SALE]: 318,
  };

  constructor(private readonly config: ConfigService) {}

  async getUsdCrcRate(
    rateType: ExchangeRateType,
    date = costaRicaToday(),
  ): Promise<ExchangeRateQuote> {
    if (!isIsoDate(date))
      throw new BccrProviderError('La fecha debe usar YYYY-MM-DD');
    if (rateType === ExchangeRateType.REFERENCE) {
      throw new BccrProviderError('BCCR no soporta tasas reference');
    }

    const token = this.config.get<string>('BCCR_TOKEN')?.trim();
    const baseUrl = (this.config.get<string>('BCCR_BASE_URL') ?? '')
      .trim()
      .replace(/\/$/, '');
    if (!token || !baseUrl)
      throw new BccrProviderError('BCCR no está configurado');

    const lookbackDays = this.readPositiveNumber('BCCR_LOOKBACK_DAYS', 7);
    const fromDate = subtractDays(date, lookbackDays - 1);
    const code =
      rateType === ExchangeRateType.PURCHASE
        ? this.indicatorCodes[ExchangeRateType.PURCHASE]
        : this.indicatorCodes[ExchangeRateType.SALE];
    const url = `${baseUrl}/indicadoresEconomicos/${code}/series?fechaInicio=${fromDate.replaceAll('-', '/')}\u0026fechaFin=${date.replaceAll('-', '/')}\u0026idioma=ES`;
    const payload = await this.fetchJson(url, token);

    if (payload.estado !== true) {
      throw new BccrProviderError(
        payload.mensaje || 'BCCR rechazó la consulta',
      );
    }

    if (!Array.isArray(payload.datos)) {
      throw new BccrProviderError('BCCR devolvió un payload inválido');
    }

    const candidates = payload.datos
      .flatMap((item) => (Array.isArray(item.series) ? item.series : []))
      .map((item) => ({
        date: item.fecha?.slice(0, 10) ?? '',
        value:
          typeof item.valorDatoPorPeriodo === 'number'
            ? item.valorDatoPorPeriodo
            : Number(item.valorDatoPorPeriodo),
      }))
      .filter(
        (item) =>
          isIsoDate(item.date) &&
          item.date <= date &&
          Number.isFinite(item.value) &&
          item.value > 0,
      )
      .sort((left, right) => right.date.localeCompare(left.date));

    const selected = candidates[0];
    if (!selected)
      throw new BccrProviderError('BCCR no devolvió una tasa válida');

    return {
      fromCurrency: 'USD',
      toCurrency: 'CRC',
      rate: selected.value,
      rateDate: selected.date,
      source: BCCR_SOURCE,
      indicatorCode: code,
      rateType,
    };
  }

  async getRate(
    fromCurrency: string,
    toCurrency: string,
    options: { rateType?: ExchangeRateType; date?: string } = {},
  ): Promise<ExchangeRateQuote> {
    const from = fromCurrency.trim().toUpperCase();
    const to = toCurrency.trim().toUpperCase();
    if (from !== USD_CURRENCY || to !== CRC_CURRENCY) {
      throw new BccrProviderError('BCCR solo soporta USD a CRC');
    }
    if (options.rateType === ExchangeRateType.REFERENCE) {
      throw new BccrProviderError('BCCR no soporta tasas reference');
    }
    return this.getUsdCrcRate(
      options.rateType ?? ExchangeRateType.SALE,
      options.date ?? costaRicaToday(),
    );
  }

  private async fetchJson(url: string, token: string): Promise<BccrResponse> {
    const timeoutMs = this.readPositiveNumber('BCCR_REQUEST_TIMEOUT_MS', 8000);
    let lastError: unknown;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          throw new BccrProviderError(
            `BCCR rechazó la autenticación (${response.status})`,
          );
        }
        if (!response.ok) {
          throw new BccrProviderError(
            `BCCR respondió HTTP ${response.status}`,
            response.status >= 500,
          );
        }
        try {
          return (await response.json()) as BccrResponse;
        } catch {
          throw new BccrProviderError('BCCR devolvió JSON inválido');
        }
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof BccrProviderError ? error.retryable : true;
        if (!retryable || attempt === 2) throw error;
        this.logger.warn(
          'Error temporal consultando BCCR; se reintentará una vez',
        );
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new BccrProviderError('Error consultando BCCR', true);
  }

  private readPositiveNumber(key: string, fallback: number): number {
    const value = Number(this.config.get<string>(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
