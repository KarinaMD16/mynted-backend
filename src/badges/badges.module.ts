import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommunityProfile } from '../community/entities/community-profile.entity';
import { Post } from '../community/entities/post.entity';
import { Reply } from '../community/entities/reply.entity';
import { UsersModule } from '../users/users.module';
import { BadgesController } from './badges.controller';
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
      Post,
      Reply,
      CommunityProfile,
    ]),
    UsersModule,
  ],
  controllers: [BadgesController],
  providers: [BadgesService, BadgesListener, BadgesSeed],
  exports: [BadgesService],
})
export class BadgesModule {}
