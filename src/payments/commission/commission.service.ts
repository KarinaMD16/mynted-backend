import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  FindOptionsWhere,
  IsNull,
  LessThanOrEqual,
  MoreThan,
  Repository,
} from 'typeorm';
import { CommissionTier } from '../entities/commission-tier.entity';
import { CommissionTierType } from '../enums/commission-tier-type.enum';
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service';

export interface PriceTierResolution {
  tier: CommissionTier;
  exchangeRate: number | null;
  normalizedAmountCrc: number | null;
}

export interface CommissionCalculation {
  rate: number;
  salesTier: string;
  priceTier: string;
  salesDiscount: number;
  priceDiscount: number;
  commissionAmount: number;
  sellerNet: number;
  exchangeRate: number | null;
  normalizedAmountCrc: number | null;
}

const DEFAULT_BASE_RATE = 0.05;
const DEFAULT_MIN_RATE = 0.02;

@Injectable()
export class CommissionService {
  constructor(
    @InjectRepository(CommissionTier)
    private readonly commissionTierRepository: Repository<CommissionTier>,
    private readonly exchangeRateService: ExchangeRateService,
    private readonly configService: ConfigService,
  ) {}

  async getSalesTier(count: number): Promise<CommissionTier> {
    this.validateSalesCount(count);
    const tier = await this.commissionTierRepository.findOne({
      where: this.rangeWhere(CommissionTierType.SALES, count, null),
    });
    if (!tier) {
      throw new NotFoundException(
        'No existe un tier de ventas activo aplicable',
      );
    }
    return tier;
  }

  async getPriceTier(
    amount: number,
    currency: string,
  ): Promise<PriceTierResolution> {
    this.validateAmount(amount);
    const normalizedCurrency = this.normalizeCurrency(currency);

    const configuredTier = await this.commissionTierRepository.findOne({
      where: {
        type: CommissionTierType.PRICE,
        currency: normalizedCurrency,
      },
    });

    if (configuredTier) {
      const tier = await this.findActivePriceTier(amount, normalizedCurrency);
      if (!tier) {
        throw new NotFoundException(
          `No existe un tier de precio activo aplicable para ${normalizedCurrency}`,
        );
      }
      return {
        tier,
        exchangeRate: null,
        normalizedAmountCrc: null,
      };
    }

    const conversion = await this.exchangeRateService.convert(
      amount,
      normalizedCurrency,
      'CRC',
    );
    const tier = await this.findActivePriceTier(conversion.amount, 'CRC');
    if (!tier) {
      throw new NotFoundException(
        'No existe un tier de precio CRC activo aplicable',
      );
    }
    return {
      tier,
      exchangeRate: conversion.rate,
      normalizedAmountCrc: conversion.amount,
    };
  }

  async calculate(
    amount: number,
    currency: string,
    salesCount: number,
  ): Promise<CommissionCalculation> {
    this.validateAmount(amount);
    this.validateSalesCount(salesCount);

    const [salesTier, priceResolution] = await Promise.all([
      this.getSalesTier(salesCount),
      this.getPriceTier(amount, currency),
    ]);
    const { baseRate, minRate } = this.readRates();
    const rate = this.roundRate(
      Math.max(
        baseRate - salesTier.discount - priceResolution.tier.discount,
        minRate,
      ),
    );
    const commissionAmount = this.roundMoney(amount * rate);

    return {
      rate,
      salesTier: salesTier.name,
      priceTier: priceResolution.tier.name,
      salesDiscount: salesTier.discount,
      priceDiscount: priceResolution.tier.discount,
      commissionAmount,
      sellerNet: this.roundMoney(amount - commissionAmount),
      exchangeRate: priceResolution.exchangeRate,
      normalizedAmountCrc: priceResolution.normalizedAmountCrc,
    };
  }

  private async findActivePriceTier(
    amount: number,
    currency: string,
  ): Promise<CommissionTier | null> {
    return this.commissionTierRepository.findOne({
      where: this.rangeWhere(CommissionTierType.PRICE, amount, currency),
    });
  }

  private rangeWhere(
    type: CommissionTierType,
    value: number,
    currency: string | null,
  ): FindOptionsWhere<CommissionTier>[] {
    const base = {
      type,
      isActive: true,
      minValue: LessThanOrEqual(value),
      currency: currency === null ? IsNull() : currency,
    };
    return [
      { ...base, maxValue: MoreThan(value) },
      { ...base, maxValue: IsNull() },
    ];
  }

  private normalizeCurrency(currency: string): string {
    if (typeof currency !== 'string' || currency.trim() === '') {
      throw new BadRequestException('La moneda es obligatoria');
    }
    return currency.trim().toUpperCase();
  }

  private validateAmount(amount: number): void {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException(
        'El monto debe ser un número mayor que cero',
      );
    }
  }

  private validateSalesCount(count: number): void {
    if (
      typeof count !== 'number' ||
      !Number.isFinite(count) ||
      !Number.isInteger(count) ||
      count < 0
    ) {
      throw new BadRequestException(
        'La cantidad de ventas debe ser un entero mayor o igual que cero',
      );
    }
  }

  private readRates(): { baseRate: number; minRate: number } {
    const baseRate = this.readRate('COMMISSION_BASE_RATE', DEFAULT_BASE_RATE);
    const minRate = this.readRate('COMMISSION_MIN_RATE', DEFAULT_MIN_RATE);
    if (minRate > baseRate) {
      throw new BadRequestException(
        'COMMISSION_MIN_RATE no puede ser mayor que COMMISSION_BASE_RATE',
      );
    }
    return { baseRate, minRate };
  }

  private readRate(key: string, defaultValue: number): number {
    const configured = this.configService.get<string>(key);
    if (configured === undefined || configured === null) return defaultValue;
    if (configured.trim() === '') {
      throw new BadRequestException(`${key} es inválido`);
    }
    const value = Number(configured);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new BadRequestException(`${key} es inválido`);
    }
    return value;
  }

  private roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private roundRate(value: number): number {
    return Math.round((value + Number.EPSILON) * 10000) / 10000;
  }
}
