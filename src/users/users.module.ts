import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserOAuthAccount } from './entities/user-oauth-account.entity';
import { Seller } from '../sellers/entities/seller.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { AuthModule } from '../auth/auth.module';
import { ResponseTimeModule } from '../response-time/response-time.module';
import { Post } from '../community/entities/post.entity';
import { Reply } from '../community/entities/reply.entity';
import { Product } from '../products/entities/product.entity';
import { ModerationModule } from '../moderation/moderation.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserOAuthAccount, Seller]),
    TypeOrmModule.forFeature([Post, Reply, Product]),
    CloudinaryModule,
    forwardRef(() => AuthModule),
    ResponseTimeModule,
    forwardRef(() => ModerationModule),
    NotificationsModule,
  ],
  providers: [UsersService, SuperAdminGuard],
  controllers: [UsersController],
  exports: [UsersService], // lo vas a necesitar en el módulo de Auth (716)
})
export class UsersModule {}
