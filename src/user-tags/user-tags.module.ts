import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tag } from '../community/entities/tag.entity';
import { UserTag } from './entities/user-tag.entity';
import { UserTagsService } from './user-tags.service';
import { UserTagsController } from './user-tags.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([Tag, UserTag]), UsersModule],
  providers: [UserTagsService],
  controllers: [UserTagsController],
})
export class UserTagsModule {}
