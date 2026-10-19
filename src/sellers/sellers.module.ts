import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { Seller } from './entities/seller.entity';
import { PaymentInfo } from './entities/payment-info.entity';
import { SellersService } from './sellers.service';
import { SellersController } from './sellers.controller';
import { SellerCommissionController } from './seller-commission.controller';
import { SellerGuard } from '../auth/guards/seller.guard';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Seller, PaymentInfo]),
    UsersModule,
    PaymentsModule,
  ],
  providers: [SellersService, SuperAdminGuard, SellerGuard],
  controllers: [SellersController, SellerCommissionController],
})
export class SellersModule {}
