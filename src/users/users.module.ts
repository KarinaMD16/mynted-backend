import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserOAuthAccount } from './entities/user-oauth-account.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserOAuthAccount])],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService], // lo vas a necesitar en el módulo de Auth (716)
})
export class UsersModule {}
