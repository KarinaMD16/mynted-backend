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
    await this.categoryRepository
      .createQueryBuilder()
      .insert()
      .into(Category)
      .values(INITIAL_CATEGORY_NAMES.map((name) => ({ name })))
      .orIgnore()
      .execute();
  }
}
