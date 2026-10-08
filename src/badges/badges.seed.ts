import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BASE_BADGES } from './badges.config';
import { Badge } from './entities/badge.entity';

// Siembra los badges base. Inserta solo los que faltan (por code), así los
// cambios manuales posteriores (nombre, ícono, isActive) no se pisan.
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
      .values(
        BASE_BADGES.map((badge) => ({
          ...badge,
          icon: null,
          isActive: true,
        })),
      )
      .orIgnore()
      .execute();
  }
}
