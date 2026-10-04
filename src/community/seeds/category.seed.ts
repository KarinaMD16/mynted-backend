import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from '../entities/category.entity';

const INITIAL_CATEGORY_NAMES = [
  'My Little Pony',
  'Pokémon TCG',
  'Funko Pop',
  'Anime Figures',
  'Naruto',
  'Digimon',
  'Hot Wheels',
  'Pintura y modelismo',
  'Otra',
];

@Injectable()
export class CategorySeed implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const existingCategories = await this.categoryRepository.find({
      select: { name: true },
    });
    const existingNames = new Set(
      existingCategories.map((category) => category.name),
    );
    const missingCategoryNames = INITIAL_CATEGORY_NAMES.filter(
      (name) => !existingNames.has(name),
    );

    if (missingCategoryNames.length === 0) return;

    await this.categoryRepository
      .createQueryBuilder()
      .insert()
      .into(Category)
      .values(missingCategoryNames.map((name) => ({ name })))
      .orIgnore()
      .execute();
  }
}
