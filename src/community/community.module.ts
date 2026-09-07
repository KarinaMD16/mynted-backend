import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { UsersModule } from '../users/users.module';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';
import { Category } from './entities/category.entity';
import { CommunityRule } from './entities/community-rule.entity';
import { CommunityTag } from './entities/community-tag.entity';
import { Community } from './entities/community.entity';
import { Tag } from './entities/tag.entity';
import { CategorySeed } from './seeds/category.seed';
import { TagSeed } from './seeds/tag.seed';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Community,
      Category,
      Tag,
      CommunityTag,
      CommunityRule,
    ]),
    CloudinaryModule,
    UsersModule,
  ],
  controllers: [CommunityController],
  providers: [CommunityService, CategorySeed, TagSeed, SuperAdminGuard],
})
export class CommunityModule {}
