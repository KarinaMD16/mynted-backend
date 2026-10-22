import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentsModule } from '../payments/payments.module';
import { User } from '../users/entities/user.entity';
import { ResolveDisplayCurrencyPipe } from './display-currency.decorator';
import { PriceDisplayService } from './price-display.service';

// Conversión de precios para mostrar. Solo reutiliza ExchangeRateService de
// PaymentsModule; no modifica nada de pagos.
@Module({
  imports: [PaymentsModule, TypeOrmModule.forFeature([User])],
  providers: [PriceDisplayService, ResolveDisplayCurrencyPipe],
  exports: [PriceDisplayService, ResolveDisplayCurrencyPipe],
})
export class PricingModule {}
