/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
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
import { CommunityJoinRequest } from './entities/community-join-request.entity';
import { Post } from './entities/post.entity';
import { Reply } from './entities/reply.entity';
import { CommunityService } from './community.service';

const queryBuilder = () => {
  const qb: Record<string, any> = {};
  for (const method of [
    'innerJoinAndSelect',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'skip',
    'take',
    'select',
    'addSelect',
    'groupBy',
  ]) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getManyAndCount = jest.fn();
  qb.getRawMany = jest.fn();
  return qb;
};

describe('CommunityService.findCommunityMembers', () => {
  const buildService = () => {
    const membersQuery = queryBuilder();
    const postsQuery = queryBuilder();
    const repliesQuery = queryBuilder();
    const communityProfileRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(membersQuery),
    };
    const postRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(postsQuery),
    };
    const replyRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(repliesQuery),
    };
    const communityRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 2, isActive: false }),
    };
    const service = new CommunityService(
      communityRepository as unknown as Repository<Community>,
      {} as Repository<Category>,
      {} as Repository<Tag>,
      {} as Repository<CommunityRule>,
      { getRepository: jest.fn() } as never,
      {} as CloudinaryService,
      {} as UsersService,
      communityProfileRepository as unknown as Repository<CommunityProfile>,
      {} as Repository<CommunityJoinRequest>,
      postRepository as unknown as Repository<Post>,
      replyRepository as unknown as Repository<Reply>,
    );
    return {
      service,
      membersQuery,
      postsQuery,
      repliesQuery,
      communityProfileRepository,
      postRepository,
      replyRepository,
    };
  };

  it('maps members and grouped activity counts without per-member queries', async () => {
    const h = buildService();
    h.membersQuery.getManyAndCount.mockResolvedValue([
      [
        {
          communityProfileId: 12,
          userId: 'user-1',
          displayName: 'Nick Collector',
          role: CommunityProfileRole.OWNER,
          joinedAt: new Date('2026-10-28T12:00:00.000Z'),
          user: {
            id: 'user-1',
            username: 'nick',
            photoUrl: null,
            isActive: false,
          },
        },
        {
          communityProfileId: 11,
          userId: 'user-2',
          displayName: 'Marta',
          role: CommunityProfileRole.MEMBER,
          joinedAt: new Date('2026-10-27T12:00:00.000Z'),
          user: {
            id: 'user-2',
            username: 'marta',
            photoUrl: 'photo',
            isActive: true,
          },
        },
      ],
      2,
    ]);
    h.postsQuery.getRawMany.mockResolvedValue([
      { profileId: '12', total: '3', hidden: '1' },
      { profileId: '11', total: '1', hidden: '0' },
    ]);
    h.repliesQuery.getRawMany.mockResolvedValue([
      { profileId: '12', total: '5', hidden: '0' },
      { profileId: '11', total: '2', hidden: '1' },
    ]);

    const result = await h.service.findCommunityMembers(2, {
      page: 1,
      limit: 20,
    });

    expect(result).toEqual({
      data: [
        expect.objectContaining({
          communityProfileId: 12,
          userId: 'user-1',
          username: 'nick',
          displayName: 'Nick Collector',
          photoUrl: null,
          role: CommunityProfileRole.OWNER,
          postCount: 3,
          replyCount: 5,
          hiddenContentCount: 1,
        }),
        expect.objectContaining({
          communityProfileId: 11,
          postCount: 1,
          replyCount: 2,
          hiddenContentCount: 1,
        }),
      ],
      pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
    });
    expect(h.postRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(h.replyRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(h.membersQuery.innerJoinAndSelect).toHaveBeenCalledWith(
      'profile.user',
      'user',
      'user.deleted_at IS NULL',
    );
    expect(h.membersQuery.orderBy).toHaveBeenCalledWith(
      'profile.joined_at',
      'DESC',
    );
    expect(h.membersQuery.addOrderBy).toHaveBeenCalledWith(
      'profile.community_profile_id',
      'DESC',
    );
  });

  it('combines role and trimmed case-insensitive search with pagination', async () => {
    const h = buildService();
    h.membersQuery.getManyAndCount.mockResolvedValue([[], 0]);

    const result = await h.service.findCommunityMembers(2, {
      page: 2,
      limit: 5,
      role: CommunityProfileRole.MODERATOR,
      search: '  Nick  ',
    });

    expect(result.pagination).toEqual({
      page: 2,
      limit: 5,
      total: 0,
      totalPages: 0,
    });
    expect(h.membersQuery.andWhere).toHaveBeenCalledWith(
      'profile.role = :role',
      { role: CommunityProfileRole.MODERATOR },
    );
    expect(h.membersQuery.andWhere).toHaveBeenCalledWith(
      '(user.username ILIKE :search OR profile.display_name ILIKE :search)',
      { search: '%Nick%' },
    );
    expect(h.membersQuery.skip).toHaveBeenCalledWith(5);
    expect(h.membersQuery.take).toHaveBeenCalledWith(5);
    expect(h.postsQuery.getRawMany).not.toHaveBeenCalled();
    expect(h.repliesQuery.getRawMany).not.toHaveBeenCalled();
  });
});
