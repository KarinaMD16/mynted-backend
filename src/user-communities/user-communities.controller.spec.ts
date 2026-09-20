import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserCommunitiesController } from './user-communities.controller';

describe('UserCommunitiesController', () => {
  it('protects recommendations and passes the authenticated user', async () => {
    const userCommunitiesService = {
      findRecommendedCommunities: jest.fn().mockResolvedValue({}),
    };
    const controller = new UserCommunitiesController(
      userCommunitiesService as never,
    );
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      UserCommunitiesController,
    ) as unknown[];

    await controller.findRecommended({ user: { userId: 'user-id' } } as never, {
      page: 1,
      limit: 10,
    });

    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard]));
    expect(
      userCommunitiesService.findRecommendedCommunities,
    ).toHaveBeenCalledWith('user-id', { page: 1, limit: 10 });
  });
});
