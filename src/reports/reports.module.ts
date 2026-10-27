import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from '../community/entities/post.entity';
import { Reply } from '../community/entities/reply.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { Product } from '../products/entities/product.entity';
import { Report } from './entities/report.entity';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { CommunityReportsController } from './community-reports.controller';
import { CommunityModule } from '../community/community.module';
import { Community } from '../community/entities/community.entity';
import { CommunityProfile } from '../community/entities/community-profile.entity';
import { Message } from '../conversations/entities/message.entity';
import { User } from '../users/entities/user.entity';
import { ModerationModule } from '../moderation/moderation.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ModerationActionsModule } from '../moderation-actions/moderation-actions.module';
import { UsersModule } from '../users/users.module';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Report,
      Post,
      Reply,
      Product,
      Conversation,
      Message,
      Community,
      CommunityProfile,
      User,
    ]),
    CommunityModule,
    ModerationModule,
    NotificationsModule,
    ModerationActionsModule,
    UsersModule,
  ],
  controllers: [ReportsController, CommunityReportsController],
  providers: [ReportsService, SuperAdminGuard],
})
export class ReportsModule {}
