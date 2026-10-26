import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { ProStatusModule } from '../pro-status/pro-status.module';
import { CosmeticsController } from './cosmetics.controller';
import { CosmeticsSeed } from './cosmetics.seed';
import { CosmeticsService } from './cosmetics.service';
import { Cosmetic } from './entities/cosmetic.entity';
import { UserCosmetics } from './entities/user-cosmetics.entity';

// No importa UsersModule (lo importan Users y la tienda para mostrar los
// cosméticos), así no hay ciclos: solo depende del estado Pro y de TypeORM.
@Module({
  imports: [
    TypeOrmModule.forFeature([Cosmetic, UserCosmetics]),
    ProStatusModule,
    CloudinaryModule,
  ],
  controllers: [CosmeticsController],
  providers: [CosmeticsService, CosmeticsSeed],
  exports: [CosmeticsService],
})
export class CosmeticsModule {}
