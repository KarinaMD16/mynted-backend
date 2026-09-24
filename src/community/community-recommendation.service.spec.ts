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
import { GetCommunitiesQueryDto } from './dto/get-communities-query.dto';

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */

describe('CommunityService.findRecommendedCommunities', () => {
  const service = new CommunityService(
    {} as Repository<Community>,
    {} as Repository<Category>,
    {} as Repository<Tag>,
    {} as Repository<CommunityRule>,
    {} as never,
    {} as CloudinaryService,
    {} as UsersService,
    {} as Repository<CommunityProfile>,
    {} as never,
    {} as Repository<Post>,
  );

  function createStageQuery(count: number, startId: number) {
    const communities = Array.from({ length: count }, (_, index) => ({
      id: startId + index,
      name: `Community ${startId + index}`,
      description: 'Community',
      slug: `community-${startId + index}`,
      isPrivate: index === 0,
      imageUrl: null,
      bannerUrl: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      category: { categoryId: 1, name: 'Category' },
    })) as unknown as Community[];
    let currentSkip = 0;
    let currentTake = count;
    const query = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      clone: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(count),
      skip: jest.fn((value: number) => {
        currentSkip = value;
        return query;
      }),
      take: jest.fn((value: number) => {
        currentTake = value;
        return query;
      }),
      getRawAndEntities: jest.fn().mockImplementation(() => {
        const entities = communities.slice(
          currentSkip,
          currentSkip + currentTake,
        );
        return Promise.resolve({
          entities,
          raw: entities.map(() => ({
            member_count: '10',
            recent_post_count: '4',
            matched_interest_count: startId === 100 ? '2' : '0',
          })),
        });
      }),
    };
    return query;
  }

  function mockStages(
    interestCount: number,
    categoryCount: number,
    popularityCount: number,
  ) {
    const interestQuery = createStageQuery(interestCount, 100);
    const categoryQuery = createStageQuery(categoryCount, 200);
    const popularityQuery = createStageQuery(popularityCount, 300);
    let stageIndex = 0;
    Object.defineProperty(service, 'buildRecommendationQuery', {
      configurable: true,
      value: jest.fn(
        () => [interestQuery, categoryQuery, popularityQuery][stageIndex++ % 3],
      ),
    });
    return { interestQuery, categoryQuery, popularityQuery };
  }

  const query: GetCommunitiesQueryDto = { page: 1, limit: 10 };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not filter private communities while keeping active and membership filters', () => {
    const builders = Array.from({ length: 5 }, () => ({
      subQuery: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getQuery: jest.fn().mockReturnValue('SUBQUERY'),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
    }));
    const queuedBuilders = [...builders];
    const communityRepository = {
      createQueryBuilder: jest.fn(() => queuedBuilders.shift()),
    };
    const queryService = new CommunityService(
      communityRepository as unknown as Repository<Community>,
      {} as Repository<Category>,
      {} as Repository<Tag>,
      {} as Repository<CommunityRule>,
      {} as never,
      {} as CloudinaryService,
      {} as UsersService,
      {} as Repository<CommunityProfile>,
      {} as never,
      {} as Repository<Post>,
    );

    Object.getOwnPropertyDescriptor(
      CommunityService.prototype,
      'buildRecommendationQuery',
    )?.value.call(queryService, 'user-id', 'interests');

    const mainQuery = builders[4];
    const conditions = [
      ...((mainQuery?.where.mock.calls ?? []) as unknown[]),
      ...((mainQuery?.andWhere.mock.calls ?? []) as unknown[]),
    ];
    const conditionText = JSON.stringify(conditions);

    expect(conditionText).toContain('community.is_active');
    expect(conditionText).toContain('recommendation_membership');
    expect(conditionText).not.toContain('community.is_private');
  });

  it('allows private communities in interests, categories and popularity stages', async () => {
    const { interestQuery, categoryQuery, popularityQuery } = mockStages(
      1,
      1,
      1,
    );

    const result = await service.findRecommendedCommunities('user-id', {
      page: 1,
      limit: 3,
    });

    expect(result.data).toHaveLength(3);
    expect(result.data.every((community) => community.isPrivate)).toBe(true);
    expect(interestQuery.getRawAndEntities).toHaveBeenCalled();
    expect(categoryQuery.getRawAndEntities).toHaveBeenCalled();
    expect(popularityQuery.getRawAndEntities).toHaveBeenCalled();
  });

  it('returns only interest results when they fill the requested limit', async () => {
    const { interestQuery, categoryQuery, popularityQuery } = mockStages(
      12,
      3,
      5,
    );

    const result = await service.findRecommendedCommunities('user-id', query);

    expect(result.data).toHaveLength(10);
    expect(result.data.every((community) => community.id < 200)).toBe(true);
    expect(categoryQuery.getRawAndEntities).not.toHaveBeenCalled();
    expect(popularityQuery.getRawAndEntities).not.toHaveBeenCalled();
    expect(interestQuery.take).toHaveBeenCalledWith(10);
    expect(result.pagination).toMatchObject({ total: 20, totalPages: 2 });
  });

  it('fills the page sequentially with interests, categories and popularity', async () => {
    const { interestQuery, categoryQuery, popularityQuery } = mockStages(
      6,
      3,
      5,
    );

    const result = await service.findRecommendedCommunities('user-id', query);

    expect(result.data).toHaveLength(10);
    expect(
      result.data.slice(0, 6).every((community) => community.id < 200),
    ).toBe(true);
    expect(
      result.data
        .slice(6, 9)
        .every((community) => community.id >= 200 && community.id < 300),
    ).toBe(true);
    expect(result.data[9].id).toBe(300);
    expect(interestQuery.take).toHaveBeenCalledWith(10);
    expect(categoryQuery.take).toHaveBeenCalledWith(4);
    expect(popularityQuery.take).toHaveBeenCalledWith(1);
    expect(result.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 14,
      totalPages: 2,
    });
  });

  it('keeps page offsets correct across recommendation stages', async () => {
    const { interestQuery, categoryQuery, popularityQuery } = mockStages(
      6,
      3,
      5,
    );

    const result = await service.findRecommendedCommunities('user-id', {
      page: 2,
      limit: 5,
    });

    expect(interestQuery.skip).toHaveBeenCalledWith(5);
    expect(interestQuery.take).toHaveBeenCalledWith(5);
    expect(categoryQuery.skip).toHaveBeenCalledWith(0);
    expect(categoryQuery.take).toHaveBeenCalledWith(4);
    expect(popularityQuery.skip).toHaveBeenCalledWith(0);
    expect(popularityQuery.take).toHaveBeenCalledWith(1);
    expect(result.pagination).toMatchObject({ page: 2, limit: 5, total: 14 });
  });

  it('skips empty interest or category stages and falls back to popularity', async () => {
    const first = mockStages(0, 3, 5);
    const resultWithoutInterests = await service.findRecommendedCommunities(
      'user-id',
      query,
    );

    expect(first.interestQuery.getRawAndEntities).not.toHaveBeenCalled();
    expect(resultWithoutInterests.data[0].id).toBe(200);

    const second = mockStages(3, 0, 5);
    const resultWithoutCategories = await service.findRecommendedCommunities(
      'user-id',
      query,
    );

    expect(second.categoryQuery.getRawAndEntities).not.toHaveBeenCalled();
    expect(resultWithoutCategories.data[3].id).toBe(300);
  });
});
