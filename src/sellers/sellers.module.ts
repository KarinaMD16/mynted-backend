import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { Seller } from './entities/seller.entity';
import { PaymentInfo } from './entities/payment-info.entity';
import { SellersService } from './sellers.service';
import { SellersController } from './sellers.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Seller, PaymentInfo]), UsersModule],
  providers: [SellersService, SuperAdminGuard],
  controllers: [SellersController],
})
export class SellersModule {}
