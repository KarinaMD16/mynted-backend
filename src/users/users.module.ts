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
import { ProStatusModule } from '../pro-status/pro-status.module';
import { ResponseTimeModule } from '../response-time/response-time.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserOAuthAccount, Seller]),
    CloudinaryModule,
    forwardRef(() => AuthModule),
    ResponseTimeModule,
    ProStatusModule,
  ],
  providers: [UsersService, SuperAdminGuard],
  controllers: [UsersController],
  exports: [UsersService], // lo vas a necesitar en el módulo de Auth (716)
})
export class UsersModule {}
