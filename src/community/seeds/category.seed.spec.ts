import { Repository } from 'typeorm';
import { Category } from '../entities/category.entity';
import { CategorySeed } from './category.seed';

describe('CategorySeed', () => {
  it('inserts missing categories without updating existing ones', async () => {
    const queryBuilder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const repository = {
      find: jest.fn().mockResolvedValue([{ name: 'Otra' }]),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      save: jest.fn(),
      update: jest.fn(),
    };
    const seed = new CategorySeed(
      repository as unknown as Repository<Category>,
    );

    await seed.onApplicationBootstrap();

    expect(queryBuilder.into).toHaveBeenCalledWith(Category);
    expect(queryBuilder.values).toHaveBeenCalledWith(
      expect.not.arrayContaining([{ name: 'Otra' }]),
    );
    expect(queryBuilder.orIgnore).toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('does not execute an insert when all seed categories already exist', async () => {
    const repository = {
      find: jest
        .fn()
        .mockResolvedValue([
          { name: 'My Little Pony' },
          { name: 'Pokémon TCG' },
          { name: 'Funko Pop' },
          { name: 'Anime Figures' },
          { name: 'Naruto' },
          { name: 'Digimon' },
          { name: 'Hot Wheels' },
          { name: 'Pintura y modelismo' },
          { name: 'Otra' },
        ]),
      createQueryBuilder: jest.fn(),
    };
    const seed = new CategorySeed(
      repository as unknown as Repository<Category>,
    );

    await seed.onApplicationBootstrap();

    expect(repository.createQueryBuilder).not.toHaveBeenCalled();
  });
});
