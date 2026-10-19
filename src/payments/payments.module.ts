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
import { PAYMENT_GATEWAY } from './gateway/payment-gateway.constants';
import { SimulatedPaymentGateway } from './gateway/simulated-payment.gateway';
import { Product } from '../products/entities/product.entity';
import { Seller } from '../sellers/entities/seller.entity';
import { User } from '../users/entities/user.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CommissionTier,
      PaymentTransaction,
      ExchangeRateSnapshot,
      Product,
      Seller,
      User,
    ]),
  ],
  controllers: [PaymentsController],
  providers: [
    CommissionTierSeed,
    BccrExchangeRateProvider,
    ExchangeRateService,
    CommissionService,
    PaymentsService,
    SimulatedPaymentGateway,
    { provide: EXCHANGE_RATE_PROVIDER, useExisting: BccrExchangeRateProvider },
    { provide: PAYMENT_GATEWAY, useExisting: SimulatedPaymentGateway },
  ],
  exports: [
    TypeOrmModule,
    ExchangeRateService,
    CommissionService,
    PaymentsService,
    PAYMENT_GATEWAY,
  ],
})
export class PaymentsModule {}
