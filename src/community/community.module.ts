import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';
import { Category } from './entities/category.entity';
import { CommunityRule } from './entities/community-rule.entity';
import { CommunityTag } from './entities/community-tag.entity';
import { Community } from './entities/community.entity';
import { Tag } from './entities/tag.entity';
import { CategorySeed } from './seeds/category.seed';

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
  ],
  controllers: [CommunityController],
  providers: [CommunityService, CategorySeed],
})
export class CommunityModule {}
