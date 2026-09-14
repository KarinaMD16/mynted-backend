import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Community } from '../community/entities/community.entity';
import { CommunityProfile } from '../community/entities/community-profile.entity';
import { UsersModule } from '../users/users.module';
import { UserCommunitiesService } from './user-communities.service';
import { UserCommunitiesController } from './user-communities.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Community, CommunityProfile]),
    UsersModule,
  ],
  providers: [UserCommunitiesService],
  controllers: [UserCommunitiesController],
})
export class UserCommunitiesModule {}
