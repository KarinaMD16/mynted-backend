import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tag } from '../entities/tag.entity';

// Catálogo de tags "principales" (isInterest = true) con el que arranca el
// picker de onboarding (ver Figma "DESIGN cleanup" > Create account -
// choose interests). El superadmin puede agregar, renombrar o borrar tags
// después vía PATCH/DELETE /tags; por eso esto solo siembra si todavía no
// existe ningún tag principal, para no revivir uno que el superadmin borró.
const INITIAL_INTEREST_TAG_NAMES = [
  'Pokémon',
  'Funko Pop',
  'Trading Cards',
  'My Little Pony',
  'Anime Figures',
  'Comic Books',
  'Sports Cards',
  'Board Games',
  'Retro Games',
  'Vinyl Records',
  'Action Figures',
  'Keychains',
  'Plushies',
  'Lego Sets',
  'Model Kits',
  'Stamps',
  'Manga',
  'Vintage Dolls',
];

@Injectable()
export class TagSeed implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(Tag)
    private readonly tagRepository: Repository<Tag>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const existingInterestTags = await this.tagRepository.count({
      where: { isInterest: true },
    });
    if (existingInterestTags > 0) return;

    await this.tagRepository
      .createQueryBuilder()
      .insert()
      .into(Tag)
      .values(
        INITIAL_INTEREST_TAG_NAMES.map((name) => ({
          name,
          isInterest: true,
        })),
      )
      .orIgnore()
      .execute();
  }
}
