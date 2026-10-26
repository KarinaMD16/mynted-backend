import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { CommunityProfile } from '../community/entities/community-profile.entity';
import { ProStatusModule } from '../pro-status/pro-status.module';
import { UsersModule } from '../users/users.module';
import { AdminBadgesController, BadgesController } from './badges.controller';
import { BadgesListener } from './badges.listener';
import { BadgesSeed } from './badges.seed';
import { BadgesService } from './badges.service';
import { Badge } from './entities/badge.entity';
import { CommunityProfileBadge } from './entities/community-profile-badge.entity';
import { UserBadge } from './entities/user-badge.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Badge,
      UserBadge,
      CommunityProfileBadge,
      CommunityProfile,
    ]),
    UsersModule,
    ProStatusModule,
  ],
  controllers: [BadgesController, AdminBadgesController],
  providers: [BadgesService, BadgesListener, BadgesSeed, SuperAdminGuard],
  exports: [BadgesService],
})
export class BadgesModule {}
