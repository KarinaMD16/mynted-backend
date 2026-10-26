import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from '../community/entities/post.entity';
import { Reply } from '../community/entities/reply.entity';
import { Product } from '../products/entities/product.entity';
import { ModerationService } from './moderation.service';

@Module({
  imports: [TypeOrmModule.forFeature([Post, Reply, Product])],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
