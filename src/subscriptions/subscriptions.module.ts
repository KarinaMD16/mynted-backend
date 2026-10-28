import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { PricingModule } from '../pricing/pricing.module';
import { ProStatusModule } from '../pro-status/pro-status.module';
import { SubscriptionPayment } from './entities/subscription-payment.entity';
import { Subscription } from './entities/subscription.entity';
import { SubscriptionsCronService } from './subscriptions-cron.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

// Pro: pago, renovación manual y cancelación. De pagos solo reutiliza lo que
// exporta PaymentsModule (la pasarela por su token) y archivos sueltos
// (PaymentCardDto, PaymentCardValidationError, numericTransformer).
@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, SubscriptionPayment]),
    PaymentsModule,
    PricingModule,
    ProStatusModule,
    NotificationsModule,
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, SubscriptionsCronService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
