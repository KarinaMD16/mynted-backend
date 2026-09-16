import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Community } from '../community/entities/community.entity';
import { CommunityProfile } from '../community/entities/community-profile.entity';
import { UsersModule } from '../users/users.module';
import { UserCommunitiesService } from './user-communities.service';
import { UserCommunitiesController } from './user-communities.controller';
import { CommunityMembershipController } from './community-membership.controller';
import { CommunityModule } from '../community/community.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Community, CommunityProfile]),
    UsersModule,
    CommunityModule,
  ],
  providers: [UserCommunitiesService],
  controllers: [UserCommunitiesController, CommunityMembershipController],
})
export class UserCommunitiesModule {}
