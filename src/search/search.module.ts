import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommunityModule } from '../community/community.module';
import { Community } from '../community/entities/community.entity';
import { ProductsModule } from '../products/products.module';
import { UsersModule } from '../users/users.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Community]),
    UsersModule,
    ProductsModule,
    CommunityModule,
  ],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
