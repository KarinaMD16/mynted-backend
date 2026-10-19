import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommissionTier } from './entities/commission-tier.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { CommissionTierSeed } from './seeds/commission-tier.seed';

@Module({
  imports: [TypeOrmModule.forFeature([CommissionTier, PaymentTransaction])],
  providers: [CommissionTierSeed],
  exports: [TypeOrmModule],
})
export class PaymentsModule {}
