import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BadgesModule } from '../badges/badges.module';
import { Review } from '../products/entities/review.entity';
import { Seller } from '../sellers/entities/seller.entity';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { ReputationController } from './reputation.controller';
import { ReputationService } from './reputation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Seller, Review]),
    UsersModule,
    BadgesModule,
  ],
  controllers: [ReputationController],
  providers: [ReputationService],
})
export class ReputationModule {}
