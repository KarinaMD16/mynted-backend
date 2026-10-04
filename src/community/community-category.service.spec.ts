import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UsersService } from '../users/users.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CommunityService } from './community.service';
import { Category } from './entities/category.entity';
import { Community } from './entities/community.entity';
import { CommunityProfile } from './entities/community-profile.entity';
import { CommunityRule } from './entities/community-rule.entity';
import { Post } from './entities/post.entity';
import { Tag } from './entities/tag.entity';

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

describe('CommunityService category management', () => {
  const categoryRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const service = new CommunityService(
    {} as Repository<Community>,
    categoryRepository as unknown as Repository<Category>,
    {} as Repository<Tag>,
    {} as Repository<CommunityRule>,
    {} as never,
    {} as CloudinaryService,
    {} as UsersService,
    {} as Repository<CommunityProfile>,
    {} as never,
    {} as Repository<Post>,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    categoryRepository.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    });
    categoryRepository.create.mockImplementation(
      (values: CreateCategoryDto & { isActive: boolean }) => values,
    );
    categoryRepository.save.mockImplementation((category: Category) =>
      Promise.resolve(category),
    );
  });

  it('creates an active category with a trimmed name', async () => {
    const result = await service.createCategory({
      name: '  Pokémon  ',
    });

    expect(result).toEqual({ name: 'Pokémon', isActive: true });
    expect(categoryRepository.create).toHaveBeenCalledWith({
      name: 'Pokémon',
      isActive: true,
    });
  });

  it('rejects a duplicate using case-insensitive trimmed comparison', async () => {
    const duplicateQuery = categoryRepository.createQueryBuilder();
    duplicateQuery.getOne.mockResolvedValue({
      categoryId: 1,
      name: 'Pokémon',
      isActive: true,
    });

    await expect(
      service.createCategory({ name: '  pokemon ' }),
    ).rejects.toThrow(ConflictException);
    expect(duplicateQuery.where).toHaveBeenCalledWith(
      'LOWER(BTRIM(category.name)) = LOWER(:name)',
      { name: 'pokemon' },
    );
    expect(categoryRepository.save).not.toHaveBeenCalled();
  });

  it('lists active categories only', async () => {
    categoryRepository.find.mockResolvedValue([]);

    await service.findAllCategories();

    expect(categoryRepository.find).toHaveBeenCalledWith({
      where: { isActive: true },
      order: { categoryId: 'ASC' },
    });
  });

  it('lists inactive categories only in category id order', async () => {
    categoryRepository.find.mockResolvedValue([]);

    await service.findInactiveCategories();

    expect(categoryRepository.find).toHaveBeenCalledWith({
      where: { isActive: false },
      order: { categoryId: 'ASC' },
    });
  });

  it('activates and deactivates idempotently', async () => {
    const category = { categoryId: 1, name: 'Pokémon', isActive: true };
    categoryRepository.findOne.mockResolvedValue(category);

    await service.activateCategory(1);
    await service.activateCategory(1);
    expect(category.isActive).toBe(true);

    await service.deactivateCategory(1);
    await service.deactivateCategory(1);
    expect(category.isActive).toBe(false);
    expect(categoryRepository.save).toHaveBeenCalledTimes(4);
  });

  it('returns 404 when activating or deactivating a missing category', async () => {
    categoryRepository.findOne.mockResolvedValue(null);

    await expect(service.activateCategory(999)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.deactivateCategory(999)).rejects.toThrow(
      NotFoundException,
    );
  });
});
