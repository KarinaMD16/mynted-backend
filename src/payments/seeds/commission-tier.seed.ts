import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommissionTier } from '../entities/commission-tier.entity';
import { CommissionTierType } from '../enums/commission-tier-type.enum';

export const INITIAL_COMMISSION_TIERS: ReadonlyArray<
  Pick<
    CommissionTier,
    'type' | 'name' | 'minValue' | 'maxValue' | 'currency' | 'discount'
  >
> = [
  {
    type: CommissionTierType.SALES,
    name: 'Bronce',
    minValue: 0,
    maxValue: 10,
    currency: null,
    discount: 0,
  },
  {
    type: CommissionTierType.SALES,
    name: 'Plata',
    minValue: 10,
    maxValue: 50,
    currency: null,
    discount: 0.005,
  },
  {
    type: CommissionTierType.SALES,
    name: 'Oro',
    minValue: 50,
    maxValue: 100,
    currency: null,
    discount: 0.01,
  },
  {
    type: CommissionTierType.SALES,
    name: 'Platino',
    minValue: 100,
    maxValue: null,
    currency: null,
    discount: 0.015,
  },
  {
    type: CommissionTierType.PRICE,
    name: 'Estándar',
    minValue: 0,
    maxValue: 25000,
    currency: 'CRC',
    discount: 0,
  },
  {
    type: CommissionTierType.PRICE,
    name: 'Medio',
    minValue: 25000,
    maxValue: 100000,
    currency: 'CRC',
    discount: 0.005,
  },
  {
    type: CommissionTierType.PRICE,
    name: 'Alto',
    minValue: 100000,
    maxValue: 250000,
    currency: 'CRC',
    discount: 0.01,
  },
  {
    type: CommissionTierType.PRICE,
    name: 'Premium',
    minValue: 250000,
    maxValue: null,
    currency: 'CRC',
    discount: 0.015,
  },
  {
    type: CommissionTierType.PRICE,
    name: 'Estándar',
    minValue: 0,
    maxValue: 50,
    currency: 'USD',
    discount: 0,
  },
  {
    type: CommissionTierType.PRICE,
    name: 'Medio',
    minValue: 50,
    maxValue: 200,
    currency: 'USD',
    discount: 0.005,
  },
  {
    type: CommissionTierType.PRICE,
    name: 'Alto',
    minValue: 200,
    maxValue: 500,
    currency: 'USD',
    discount: 0.01,
  },
  {
    type: CommissionTierType.PRICE,
    name: 'Premium',
    minValue: 500,
    maxValue: null,
    currency: 'USD',
    discount: 0.015,
  },
];

@Injectable()
export class CommissionTierSeed implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(CommissionTier)
    private readonly commissionTierRepository: Repository<CommissionTier>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const existingCount = await this.commissionTierRepository.count();
    if (existingCount > 0) return;

    await this.commissionTierRepository.insert(
      INITIAL_COMMISSION_TIERS.map((tier) => ({ ...tier, isActive: true })),
    );
  }
}
