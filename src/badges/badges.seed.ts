import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BASE_BADGES } from './badges.config';
import { Badge } from './entities/badge.entity';

// Seed idempotente del catálogo (upsert por `code`, mismo patrón que el seed
// de Interests). Crea los que faltan y actualiza textos, scope, rareza y
// métrica de los existentes, pero NO pisa `threshold` ni `isActive`: así los
// umbrales se ajustan en la base sin tocar código.
@Injectable()
export class BadgesSeed implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(Badge)
    private readonly badgeRepository: Repository<Badge>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.badgeRepository
      .createQueryBuilder()
      .insert()
      .into(Badge)
      .values(BASE_BADGES.map((badge) => ({ ...badge, isActive: true })))
      .orUpdate(['name', 'description', 'scope', 'rarity', 'metric'], ['code'])
      .execute();
  }
}
