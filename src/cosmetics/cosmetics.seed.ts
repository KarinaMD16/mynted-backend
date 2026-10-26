import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BASE_COSMETICS } from './cosmetics.config';
import { Cosmetic } from './entities/cosmetic.entity';

// Seed idempotente del catálogo (upsert por `code`, mismo patrón que
// BadgesSeed). Crea los que faltan y actualiza los datos de los existentes,
// pero NO pisa `is_active`: así un cosmético se retira desde la base sin
// tocar código.
@Injectable()
export class CosmeticsSeed implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(Cosmetic)
    private readonly cosmeticRepository: Repository<Cosmetic>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.cosmeticRepository
      .createQueryBuilder()
      .insert()
      .into(Cosmetic)
      .values(BASE_COSMETICS.map((definition) => ({ ...definition })))
      .orUpdate(
        ['type', 'name', 'asset_url', 'pro_only', 'is_default', 'sort_order'],
        ['code'],
      )
      .execute();
  }
}
