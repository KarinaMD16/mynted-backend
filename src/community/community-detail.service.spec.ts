import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UsersService } from '../users/users.service';
import { CommunityService } from './community.service';
import { Category } from './entities/category.entity';
import { Community } from './entities/community.entity';
import {
  CommunityProfile,
  CommunityProfileRole,
} from './entities/community-profile.entity';
import { CommunityRule } from './entities/community-rule.entity';
import { Post } from './entities/post.entity';
import { Tag } from './entities/tag.entity';

describe('CommunityService.findCommunityDetail', () => {
  const communityRepository = { findOne: jest.fn() };
  const communityProfileRepository = {
    count: jest.fn(),
    findOne: jest.fn(),
  };
  const countQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn(),
  };
  const postQueryBuilder = {
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };
  const postRepository = {
    createQueryBuilder: jest
      .fn()
      .mockReturnValueOnce(countQueryBuilder)
      .mockReturnValueOnce(postQueryBuilder),
  };

  const service = new CommunityService(
    communityRepository as unknown as Repository<Community>,
    {} as Repository<Category>,
    {} as Repository<Tag>,
    {} as Repository<CommunityRule>,
    {} as never,
    {} as CloudinaryService,
    {} as UsersService,
    communityProfileRepository as unknown as Repository<CommunityProfile>,
    postRepository as unknown as Repository<Post>,
  );

  const profile = {
    communityProfileId: 20,
    displayName: 'Collector',
    role: CommunityProfileRole.MODERATOR,
  } as CommunityProfile;

  beforeEach(() => {
    jest.clearAllMocks();
    postRepository.createQueryBuilder
      .mockReset()
      .mockReturnValueOnce(countQueryBuilder)
      .mockReturnValueOnce(postQueryBuilder);
    communityRepository.findOne.mockResolvedValue({
      id: 7,
      name: 'Developers CR',
      description: 'Comunidad técnica',
      slug: 'developers-cr',
      isActive: true,
      isPrivate: false,
      imageUrl: null,
      bannerUrl: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      category: { categoryId: 1, name: 'Tecnología' },
      communityTags: [{ tag: { tagId: 3, name: 'Programación' } }],
      rules: [
        { communityRuleId: 9, description: 'B' },
        { communityRuleId: 8, description: 'A' },
      ],
    });
    communityProfileRepository.count.mockResolvedValue(3);
    communityProfileRepository.findOne.mockResolvedValue(profile);
    countQueryBuilder.getCount.mockResolvedValue(2);
    postQueryBuilder.getMany.mockResolvedValue([
      {
        id: 2,
        title: 'Segundo',
        body: 'Contenido',
        postedAt: new Date('2026-01-02T00:00:00.000Z'),
        upVotes: 3,
        downVotes: 1,
        timesSaved: 2,
        communityProfile: profile,
      },
    ]);
  });

  it('returns general data, tags, rules, metrics, membership and posts', async () => {
    const result = await service.findCommunityDetail(7, 'user-id');

    expect(result).toMatchObject({
      id: 7,
      category: { categoryId: 1, name: 'Tecnología' },
      tags: [{ tagId: 3, name: 'Programación' }],
      rules: [
        { communityRuleId: 8, description: 'A' },
        { communityRuleId: 9, description: 'B' },
      ],
      memberCount: 3,
      recentPostCount: 2,
      isMember: true,
      membershipRole: CommunityProfileRole.MODERATOR,
      forumPosts: [{ id: 2, title: 'Segundo' }],
    });
    expect(result.popularityScore).toBe(
      0.7 * Math.log1p(3) + 0.3 * Math.log1p(2),
    );
    expect(postQueryBuilder.orderBy).toHaveBeenCalledWith(
      'post.posted_at',
      'DESC',
    );
    expect(postQueryBuilder.take).toHaveBeenCalledWith(10);
  });

  it('returns false and null role for a non-member', async () => {
    communityProfileRepository.findOne.mockResolvedValue(null);

    const result = await service.findCommunityDetail(7, 'other-user');

    expect(result.isMember).toBe(false);
    expect(result.membershipRole).toBeNull();
  });

  it('rejects missing or inactive communities', async () => {
    communityRepository.findOne.mockResolvedValue(null);

    await expect(service.findCommunityDetail(999, 'user-id')).rejects.toThrow(
      NotFoundException,
    );
    expect(communityProfileRepository.count).not.toHaveBeenCalled();
    expect(postRepository.createQueryBuilder).not.toHaveBeenCalled();
  });
});
