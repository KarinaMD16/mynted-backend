import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { ModerationAction } from './entities/moderation-action.entity';
import { ModerationActionsController } from './moderation-actions.controller';
import { ModerationActionsService } from './moderation-actions.service';

@Module({
  imports: [TypeOrmModule.forFeature([ModerationAction, User]), UsersModule],
  controllers: [ModerationActionsController],
  providers: [ModerationActionsService],
  exports: [ModerationActionsService],
})
export class ModerationActionsModule {}
