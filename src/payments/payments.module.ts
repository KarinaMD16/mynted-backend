import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommissionTier } from './entities/commission-tier.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { ExchangeRateSnapshot } from './entities/exchange-rate-snapshot.entity';
import { CommissionTierSeed } from './seeds/commission-tier.seed';
import { BccrExchangeRateProvider } from './exchange-rate/bccr-exchange-rate.provider';
import { FrankfurterExchangeRateProvider } from './exchange-rate/frankfurter-exchange-rate.provider';
import { ExchangeRateService } from './exchange-rate/exchange-rate.service';
import {
  BCCR_EXCHANGE_RATE_PROVIDER,
  EXCHANGE_RATE_PROVIDER,
  FRANKFURTER_EXCHANGE_RATE_PROVIDER,
} from './exchange-rate/exchange-rate.constants';
import { CommissionService } from './commission/commission.service';
import { PAYMENT_GATEWAY } from './gateway/payment-gateway.constants';
import { SimulatedPaymentGateway } from './gateway/simulated-payment.gateway';
import { Product } from '../products/entities/product.entity';
import { Seller } from '../sellers/entities/seller.entity';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentHistoryService } from './payment-history.service';
import { CommissionCatalogService } from './commission/commission-catalog.service';
import { CommissionTiersController } from './commission-tiers.controller';
import { AdminCommissionTiersController } from './admin-commission-tiers.controller';
import { AdminPaymentsController } from './admin-payments.controller';
import { AdminCommissionTiersService } from './admin-commission-tiers.service';
import { AdminPaymentSummaryService } from './admin-payment-summary.service';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([
      CommissionTier,
      PaymentTransaction,
      ExchangeRateSnapshot,
      Product,
      Seller,
      User,
    ]),
  ],
  controllers: [
    PaymentsController,
    CommissionTiersController,
    AdminCommissionTiersController,
    AdminPaymentsController,
  ],
  providers: [
    CommissionTierSeed,
    BccrExchangeRateProvider,
    FrankfurterExchangeRateProvider,
    ExchangeRateService,
    CommissionService,
    PaymentsService,
    PaymentHistoryService,
    CommissionCatalogService,
    AdminCommissionTiersService,
    AdminPaymentSummaryService,
    SuperAdminGuard,
    SimulatedPaymentGateway,
    { provide: EXCHANGE_RATE_PROVIDER, useExisting: BccrExchangeRateProvider },
    {
      provide: BCCR_EXCHANGE_RATE_PROVIDER,
      useExisting: BccrExchangeRateProvider,
    },
    {
      provide: FRANKFURTER_EXCHANGE_RATE_PROVIDER,
      useExisting: FrankfurterExchangeRateProvider,
    },
    { provide: PAYMENT_GATEWAY, useExisting: SimulatedPaymentGateway },
  ],
  exports: [
    TypeOrmModule,
    ExchangeRateService,
    CommissionService,
    PaymentsService,
    PaymentHistoryService,
    CommissionCatalogService,
    PAYMENT_GATEWAY,
  ],
})
export class PaymentsModule {}
