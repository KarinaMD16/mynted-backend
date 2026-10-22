import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserBadge } from '../badges/entities/user-badge.entity';
import { ProductsModule } from '../products/products.module';
import { Seller } from '../sellers/entities/seller.entity';
import { UsersModule } from '../users/users.module';
import { SellersPublicController } from './sellers-public.controller';
import { SellersPublicService } from './sellers-public.service';

// Tienda pública. Módulo aparte de SellersModule (solicitud y comisión) para
// no tocar esa lógica.
@Module({
  imports: [
    TypeOrmModule.forFeature([Seller, UserBadge]),
    UsersModule,
    ProductsModule,
  ],
  controllers: [SellersPublicController],
  providers: [SellersPublicService],
  exports: [SellersPublicService],
})
export class SellersPublicModule {}
