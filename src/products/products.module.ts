import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { SellerGuard } from '../auth/guards/seller.guard';
import { Community } from '../community/entities/community.entity';
import { CommunityProfile } from '../community/entities/community-profile.entity';
import { Favorite } from '../community/entities/favorite.entity';
import { Tag } from '../community/entities/tag.entity';
import { Seller } from '../sellers/entities/seller.entity';
import { UserTag } from '../user-tags/entities/user-tag.entity';
import { Product } from './entities/product.entity';
import { ProductTag } from './entities/product-tag.entity';
import { ProductImage } from './entities/product-image.entity';
import { ProductRelated } from './entities/product-related.entity';
import { ProductView } from './entities/product-view.entity';
import { Review } from './entities/review.entity';
import { ProductsController } from './products.controller';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
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
      UserTag,
      Review,
      ProductRelated,
      ProductView,
      CommunityProfile,
      Favorite,
    ]),
    UsersModule,
    CloudinaryModule,
  ],
  controllers: [ProductsController, ReviewsController],
  providers: [ProductsService, ReviewsService, SellerGuard],
  exports: [ProductsService],
})
export class ProductsModule {}
