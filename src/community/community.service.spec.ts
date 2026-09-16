import { Repository } from 'typeorm';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UsersService } from '../users/users.service';
import {
  CommunityProfile,
  CommunityProfileRole,
} from './entities/community-profile.entity';
import { Community } from './entities/community.entity';
import { Category } from './entities/category.entity';
import { CommunityRule } from './entities/community-rule.entity';
import { Tag } from './entities/tag.entity';
import { CommunityService } from './community.service';

/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */

describe('CommunityService.create', () => {
  it('creates the owner profile with the same transaction manager', async () => {
    const savedCommunity = { id: 42 } as Community;
    const user = { id: 'user-id', username: 'collector' };
    const manager = {
      create: jest.fn((entity, values) => ({ ...values })),
      save: jest.fn(async (entity, value) => {
        if (entity === Community) return savedCommunity;
        return value;
      }),
      findOne: jest.fn(async () => ({
        ...savedCommunity,
        category: {},
        communityTags: [],
        rules: [],
      })),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const usersService = {
      findById: jest.fn().mockResolvedValue(user),
    };
    const communityRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    const categoryRepository = {
      findOne: jest.fn().mockResolvedValue({ categoryId: 1 }),
    };
    const tagRepository = {
      find: jest.fn().mockResolvedValue([{ tagId: 1 }]),
    };
    const communityRuleRepository = {};
    const cloudinaryService = {};

    const service = new CommunityService(
      communityRepository as unknown as Repository<Community>,
      categoryRepository as unknown as Repository<Category>,
      tagRepository as unknown as Repository<Tag>,
      communityRuleRepository as unknown as Repository<CommunityRule>,
      dataSource as never,
      cloudinaryService as unknown as CloudinaryService,
      usersService as unknown as UsersService,
      {} as never,
      {} as never,
    );

    await service.create(
      {
        name: 'Collectors',
        description: 'Community',
        slug: 'collectors',
        isPrivate: false,
        categoryId: 1,
        tagIds: [1],
        rules: [],
      },
      undefined,
      undefined,
      user.id,
    );

    const profile = manager.create.mock.calls.find(
      ([entity]) => entity === CommunityProfile,
    )?.[1] as CommunityProfile;

    expect(usersService.findById).toHaveBeenCalledWith(user.id);
    expect(profile).toMatchObject({
      displayName: user.username,
      bio: '',
      role: CommunityProfileRole.OWNER,
      userId: user.id,
      communityId: savedCommunity.id,
    });
    expect(manager.save).toHaveBeenCalledWith(CommunityProfile, profile);
    expect(dataSource.transaction).toHaveBeenCalledWith(expect.any(Function));
  });

  it('rejects and keeps profile creation inside the transaction when it fails', async () => {
    const manager = {
      create: jest.fn((entity, values) => ({ ...values })),
      save: jest.fn(async (entity, value) => {
        if (entity === Community) return { id: 42 } as Community;
        if (entity === CommunityProfile) throw new Error('profile failure');
        return value;
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const service = new CommunityService(
      {
        findOne: jest.fn().mockResolvedValue(null),
      } as unknown as Repository<Community>,
      {
        findOne: jest.fn().mockResolvedValue({ categoryId: 1 }),
      } as unknown as Repository<Category>,
      {
        find: jest.fn().mockResolvedValue([{ tagId: 1 }]),
      } as unknown as Repository<Tag>,
      {} as Repository<CommunityRule>,
      dataSource as never,
      {} as CloudinaryService,
      {
        findById: jest
          .fn()
          .mockResolvedValue({ id: 'user-id', username: 'collector' }),
      } as unknown as UsersService,
      {} as never,
      {} as never,
    );

    await expect(
      service.create(
        {
          name: 'Collectors',
          description: 'Community',
          slug: 'collectors',
          isPrivate: false,
          categoryId: 1,
          tagIds: [1],
          rules: [],
        },
        undefined,
        undefined,
        'user-id',
      ),
    ).rejects.toThrow('Ocurrió un error al crear la comunidad');

    expect(dataSource.transaction).toHaveBeenCalledWith(expect.any(Function));
    expect(manager.save).toHaveBeenCalledWith(
      CommunityProfile,
      expect.objectContaining({ role: CommunityProfileRole.OWNER }),
    );
  });
});
