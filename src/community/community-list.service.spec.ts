import { Repository } from 'typeorm';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UsersService } from '../users/users.service';
import { CommunityService } from './community.service';
import { Category } from './entities/category.entity';
import { Community } from './entities/community.entity';
import { CommunityRule } from './entities/community-rule.entity';
import { Tag } from './entities/tag.entity';
import { GetCommunitiesQueryDto } from './dto/get-communities-query.dto';

describe('CommunityService community listings', () => {
  const service = new CommunityService(
    {} as Repository<Community>,
    {} as Repository<Category>,
    {} as Repository<Tag>,
    {} as Repository<CommunityRule>,
    {} as never,
    {} as CloudinaryService,
    {} as UsersService,
    {} as never,
    {} as never,
    {} as never,
  );

  const query: GetCommunitiesQueryDto = {
    page: 2,
    limit: 10,
    sort: 'popularity',
  };

  const community = {
    id: 7,
    name: 'Developers CR',
    description: 'Comunidad técnica',
    slug: 'developers-cr',
    isPrivate: false,
    imageUrl: null,
    bannerUrl: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    category: { categoryId: 1, name: 'Tecnología' },
  } as unknown as Community;

  function mockQueryBuilder() {
    const result = {
      entities: [community],
      raw: [
        {
          member_count: '10',
          recent_post_count: '2',
          membership_role: 'member',
        },
      ],
    };
    const queryBuilder = {
      clone: jest.fn().mockReturnValue({
        getCount: jest.fn().mockResolvedValue(11),
      }),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getRawAndEntities: jest.fn().mockResolvedValue(result),
    };
    return queryBuilder;
  }

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('returns paginated public communities with dynamic metrics and score', async () => {
    const queryBuilder = mockQueryBuilder();
    jest
      .spyOn(service as never, 'buildCommunityListQuery' as never)
      .mockReturnValue(queryBuilder as never);

    const result = await service.findAllCommunities(query);
    const expectedScore = 0.7 * Math.log1p(10) + 0.3 * Math.log1p(2);

    expect(result.data[0]).toMatchObject({
      id: 7,
      memberCount: 10,
      recentPostCount: 2,
      popularityScore: expectedScore,
    });
    expect(result.pagination).toEqual({
      page: 2,
      limit: 10,
      total: 11,
      totalPages: 2,
    });
    expect(queryBuilder.skip).toHaveBeenCalledWith(10);
    expect(queryBuilder.take).toHaveBeenCalledWith(10);
  });

  it('includes membershipRole only in the authenticated user listing', async () => {
    const queryBuilder = mockQueryBuilder();
    jest
      .spyOn(service as never, 'buildCommunityListQuery' as never)
      .mockReturnValue(queryBuilder as never);

    const result = await service.findUserCommunities('user-id', {
      page: 1,
      limit: 10,
    });

    expect(result.data[0]).toMatchObject({ membershipRole: 'member' });
    expect(result.pagination.total).toBe(11);
  });

  it('returns zero metrics when a community has no members or recent posts', async () => {
    const queryBuilder = mockQueryBuilder();
    queryBuilder.getRawAndEntities.mockResolvedValue({
      entities: [community],
      raw: [{ member_count: '0', recent_post_count: '0' }],
    });
    jest
      .spyOn(service as never, 'buildCommunityListQuery' as never)
      .mockReturnValue(queryBuilder as never);

    const result = await service.findAllCommunities({ page: 1, limit: 10 });

    expect(result.data[0]).toMatchObject({
      memberCount: 0,
      recentPostCount: 0,
      popularityScore: 0,
    });
  });
});
