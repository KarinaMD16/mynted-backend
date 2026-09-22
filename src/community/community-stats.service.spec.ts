import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UsersService } from '../users/users.service';
import { CommunityService } from './community.service';
import { Category } from './entities/category.entity';
import { Community } from './entities/community.entity';
import { CommunityProfile } from './entities/community-profile.entity';
import { CommunityRule } from './entities/community-rule.entity';
import { Post } from './entities/post.entity';
import { Tag } from './entities/tag.entity';

describe('CommunityService.getStats', () => {
  const communityRepository = { findOne: jest.fn() };
  const communityProfileRepository = { count: jest.fn() };
  const postQueryBuilders = [
    {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getCount: jest.fn(),
    },
    {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn(),
    },
  ];
  const postRepository = {
    createQueryBuilder: jest
      .fn()
      .mockReturnValueOnce(postQueryBuilders[0])
      .mockReturnValueOnce(postQueryBuilders[1]),
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

  beforeEach(() => {
    jest.clearAllMocks();
    communityRepository.findOne.mockResolvedValue({ id: 7 });
    communityProfileRepository.count.mockResolvedValue(3);
    postQueryBuilders[0].getCount.mockResolvedValue(5);
    postQueryBuilders[1].getCount.mockResolvedValue(2);
    postRepository.createQueryBuilder
      .mockReset()
      .mockReturnValueOnce(postQueryBuilders[0])
      .mockReturnValueOnce(postQueryBuilders[1]);
  });

  it('returns member, total post and recent post counts', async () => {
    const result = await service.getStats(7);

    expect(result).toEqual({
      communityId: 7,
      memberCount: 3,
      postCount: 5,
      recentPostCount: 2,
    });
    expect(communityProfileRepository.count).toHaveBeenCalledWith({
      where: { communityId: 7 },
    });
    expect(postQueryBuilders[0].innerJoin).toHaveBeenCalledWith(
      CommunityProfile,
      'post_profile',
      'post_profile.community_profile_id = post.community_profile_id',
    );
    expect(postQueryBuilders[0].where).toHaveBeenCalledWith(
      'post_profile.community_id = :communityId',
      { communityId: 7 },
    );
  });

  it('counts all profile roles as members without filtering by role', async () => {
    communityProfileRepository.count.mockResolvedValue(3);

    await service.getStats(7);

    expect(communityProfileRepository.count).toHaveBeenCalledWith({
      where: { communityId: 7 },
    });
  });

  it('counts posts through profiles belonging to the requested community', async () => {
    await service.getStats(7);

    expect(postQueryBuilders[0].where).toHaveBeenCalledWith(
      'post_profile.community_id = :communityId',
      { communityId: 7 },
    );
    expect(postQueryBuilders[1].where).toHaveBeenCalledWith(
      'recent_post_profile.community_id = :communityId',
      { communityId: 7 },
    );
  });

  it('validates that the community is active before counting', async () => {
    await service.getStats(7);

    expect(communityRepository.findOne).toHaveBeenCalledWith({
      where: { id: 7, isActive: true },
      select: { id: true },
    });
  });

  it('returns 404 for a missing community', async () => {
    communityRepository.findOne.mockResolvedValue(null);

    await expect(service.getStats(7)).rejects.toThrow(NotFoundException);
    expect(communityProfileRepository.count).not.toHaveBeenCalled();
    expect(postRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns 404 for an inactive community', async () => {
    communityRepository.findOne.mockResolvedValue(null);

    await expect(service.getStats(7)).rejects.toThrow(NotFoundException);
    expect(communityProfileRepository.count).not.toHaveBeenCalled();
    expect(postRepository.createQueryBuilder).not.toHaveBeenCalled();
  });
});
