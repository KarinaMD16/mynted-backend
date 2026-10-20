import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { CommissionTier } from '../entities/commission-tier.entity';
import { CommissionTierType } from '../enums/commission-tier-type.enum';
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service';
import { CommissionService } from './commission.service';
import {
  isSupportedCurrency,
  normalizeSupportedCurrency,
} from '../exchange-rate/exchange-rate.constants';
import {
  CommissionMatrixRowDto,
  CommissionRateCellDto,
  PriceTierDisplayDto,
} from '../dto/commission-tiers-response.dto';

@Injectable()
export class CommissionCatalogService {
  constructor(
    @InjectRepository(CommissionTier)
    private readonly repository: Repository<CommissionTier>,
    private readonly exchangeRateService: ExchangeRateService,
    private readonly commissionService: CommissionService,
  ) {}

  async getSalesTiers(): Promise<CommissionTier[]> {
    return this.repository.find({
      where: {
        type: CommissionTierType.SALES,
        isActive: true,
        currency: IsNull(),
      },
      order: { minValue: 'ASC' },
    });
  }

  async getPriceTiers(
    currency: string,
  ): Promise<{ tiers: PriceTierDisplayDto[]; approximate: boolean }> {
    const normalized = this.normalizeCurrency(currency);
    const own = await this.repository.find({
      where: {
        type: CommissionTierType.PRICE,
        isActive: true,
        currency: normalized,
      },
      order: { minValue: 'ASC' },
    });
    if (own.length > 0) {
      return {
        tiers: own.map((tier) => this.toPriceDisplay(tier, normalized, false)),
        approximate: false,
      };
    }

    const crcTiers = await this.repository.find({
      where: {
        type: CommissionTierType.PRICE,
        isActive: true,
        currency: 'CRC',
      },
      order: { minValue: 'ASC' },
    });
    const rate =
      normalized === 'CRC'
        ? 1
        : (await this.exchangeRateService.getRate('CRC', normalized)).rate;
    return {
      tiers: crcTiers.map((tier) => ({
        ...this.toPriceDisplay(tier, normalized, true),
        minValue: this.roundMoney(tier.minValue * rate),
        maxValue:
          tier.maxValue === null ? null : this.roundMoney(tier.maxValue * rate),
      })),
      approximate: true,
    };
  }

  buildMatrix(
    salesTiers: CommissionTier[],
    priceTiers: PriceTierDisplayDto[],
  ): CommissionMatrixRowDto[] {
    return salesTiers.map((salesTier) => ({
      salesTierName: salesTier.name,
      salesDiscount: salesTier.discount,
      rates: priceTiers.map((priceTier): CommissionRateCellDto => ({
        priceTierName: priceTier.name,
        priceDiscount: priceTier.discount,
        commissionRate: this.commissionService.calculateRate(
          salesTier.discount,
          priceTier.discount,
        ),
      })),
    }));
  }

  private toPriceDisplay(
    tier: CommissionTier,
    currency: string,
    approximate: boolean,
  ): PriceTierDisplayDto {
    return {
      name: tier.name,
      minValue: tier.minValue,
      maxValue: tier.maxValue,
      discount: tier.discount,
      currency,
      approximate,
    };
  }

  private normalizeCurrency(value: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new BadRequestException('La moneda es obligatoria');
    }
    const normalized = normalizeSupportedCurrency(value);
    if (!isSupportedCurrency(normalized)) {
      throw new BadRequestException(`Moneda no soportada: ${value}`);
    }
    return normalized;
  }

  private roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
