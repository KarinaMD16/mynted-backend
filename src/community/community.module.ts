import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { UsersModule } from '../users/users.module';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';
import { CommunityRoleGuard } from './guards/community-role.guard';
import { Category } from './entities/category.entity';
import { CommunityRule } from './entities/community-rule.entity';
import { CommunityTag } from './entities/community-tag.entity';
import { Community } from './entities/community.entity';
import { Tag } from './entities/tag.entity';
import { CommunityProfile } from './entities/community-profile.entity';
import { CommunityJoinRequest } from './entities/community-join-request.entity';
import { Post } from './entities/post.entity';
import { PostTag } from './entities/post-tag.entity';
import { PostImage } from './entities/post-image.entity';
import { Reply } from './entities/reply.entity';
import { PostVote } from './entities/post-vote.entity';
import { ReplyVote } from './entities/reply-vote.entity';
import { Favorite } from './entities/favorite.entity';
import { Product } from '../products/entities/product.entity';
import { ForumController } from './forum.controller';
import { PublicProfileController } from './public-profile.controller';
import { ForumService } from './forum.service';
import { CategorySeed } from './seeds/category.seed';
import { TagSeed } from './seeds/tag.seed';
import { UserTag } from '../user-tags/entities/user-tag.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Community,
      Category,
      Tag,
      CommunityTag,
      CommunityRule,
      CommunityProfile,
      CommunityJoinRequest,
      Post,
      PostTag,
      PostImage,
      Reply,
      PostVote,
      ReplyVote,
      Favorite,
      Product,
      UserTag,
    ]),
    CloudinaryModule,
    UsersModule,
  ],
  controllers: [CommunityController, ForumController, PublicProfileController],
  providers: [
    CommunityService,
    ForumService,
    CategorySeed,
    TagSeed,
    SuperAdminGuard,
    CommunityRoleGuard,
  ],
  exports: [CommunityService, ForumService],
})
export class CommunityModule {}
