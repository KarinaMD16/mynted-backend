import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { SellerGuard } from '../auth/guards/seller.guard';
import { Community } from '../community/entities/community.entity';
import { Tag } from '../community/entities/tag.entity';
import { Seller } from '../sellers/entities/seller.entity';
import { Product } from './entities/product.entity';
import { ProductTag } from './entities/product-tag.entity';
import { ProductImage } from './entities/product-image.entity';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Product,
      ProductTag,
      ProductImage,
      Seller,
      Community,
      Tag,
    ]),
    UsersModule,
    CloudinaryModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService, SellerGuard],
})
export class ProductsModule {}
