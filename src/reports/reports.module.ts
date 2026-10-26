import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from '../community/entities/post.entity';
import { Reply } from '../community/entities/reply.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { Product } from '../products/entities/product.entity';
import { Report } from './entities/report.entity';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Report, Post, Reply, Product, Conversation]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
