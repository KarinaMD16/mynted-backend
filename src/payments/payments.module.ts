import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommissionTier } from './entities/commission-tier.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { ExchangeRateSnapshot } from './entities/exchange-rate-snapshot.entity';
import { CommissionTierSeed } from './seeds/commission-tier.seed';
import { BccrExchangeRateProvider } from './exchange-rate/bccr-exchange-rate.provider';
import { ExchangeRateService } from './exchange-rate/exchange-rate.service';
import { EXCHANGE_RATE_PROVIDER } from './exchange-rate/exchange-rate.constants';
import { CommissionService } from './commission/commission.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CommissionTier,
      PaymentTransaction,
      ExchangeRateSnapshot,
    ]),
  ],
  providers: [
    CommissionTierSeed,
    BccrExchangeRateProvider,
    ExchangeRateService,
    CommissionService,
    { provide: EXCHANGE_RATE_PROVIDER, useExisting: BccrExchangeRateProvider },
  ],
  exports: [TypeOrmModule, ExchangeRateService, CommissionService],
})
export class PaymentsModule {}
