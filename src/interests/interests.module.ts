import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { Interest } from './entities/interest.entity';
import { UserInterest } from './entities/user-interest.entity';
import { InterestsService } from './interests.service';
import { InterestsController } from './interests.controller';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Interest, UserInterest]), UsersModule],
  providers: [InterestsService, SuperAdminGuard],
  controllers: [InterestsController],
})
export class InterestsModule {}
