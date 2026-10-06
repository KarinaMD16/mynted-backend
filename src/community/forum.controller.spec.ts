import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CommunityProfileRole } from './entities/community-profile.entity';
import { CommunityRoleGuard } from './guards/community-role.guard';
import { COMMUNITY_ROLES_KEY } from './decorators/require-community-role.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ForumController } from './forum.controller';

describe('ForumController', () => {
  it('protects post creation with JWT and community role guards', () => {
    const method = Object.getOwnPropertyDescriptor(
      ForumController.prototype,
      'createPost',
    )?.value as (...args: never[]) => unknown;

    expect(Reflect.getMetadata(GUARDS_METADATA, method)).toEqual(
      expect.arrayContaining([JwtAuthGuard, CommunityRoleGuard]),
    );
  });

  it('allows every community member role to create posts', () => {
    const method = Object.getOwnPropertyDescriptor(
      ForumController.prototype,
      'createPost',
    )?.value as (...args: never[]) => unknown;

    expect(Reflect.getMetadata(COMMUNITY_ROLES_KEY, method)).toEqual(
      expect.arrayContaining([
        CommunityProfileRole.MEMBER,
        CommunityProfileRole.MODERATOR,
        CommunityProfileRole.OWNER,
      ]),
    );
  });

  it('passes the authenticated user to the post listing', async () => {
    const service = { findPosts: jest.fn().mockResolvedValue({}) };
    const controller = new ForumController(service as never);

    await controller.findPosts(7, { page: 1, limit: 10 }, {
      user: { userId: 'user-id' },
    } as never);

    expect(service.findPosts).toHaveBeenCalledWith(7, 'user-id', {
      page: 1,
      limit: 10,
    });
  });

  it('protects and passes the authenticated user to the global feed', async () => {
    const service = { findGlobalPosts: jest.fn().mockResolvedValue({}) };
    const controller = new ForumController(service as never);
    const request = { user: { userId: 'user-id' } };
    const method = Object.getOwnPropertyDescriptor(
      ForumController.prototype,
      'findGlobalPosts',
    )?.value as (...args: never[]) => unknown;

    await controller.findGlobalPosts({ page: 1, limit: 20 }, request as never);

    expect(Reflect.getMetadata(GUARDS_METADATA, method)).toEqual(
      expect.arrayContaining([JwtAuthGuard]),
    );
    expect(service.findGlobalPosts).toHaveBeenCalledWith('user-id', {
      page: 1,
      limit: 20,
    });
  });

  it('protects and passes the authenticated user to recommended posts', async () => {
    const service = { findRecommendedPosts: jest.fn().mockResolvedValue({}) };
    const controller = new ForumController(service as never);
    const request = { user: { userId: 'user-id' } };
    const method = Object.getOwnPropertyDescriptor(
      ForumController.prototype,
      'findRecommendedPosts',
    )?.value as (...args: never[]) => unknown;

    await controller.findRecommendedPosts(
      { page: 1, limit: 10 },
      request as never,
    );

    expect(Reflect.getMetadata(GUARDS_METADATA, method)).toEqual(
      expect.arrayContaining([JwtAuthGuard]),
    );
    expect(service.findRecommendedPosts).toHaveBeenCalledWith('user-id', {
      page: 1,
      limit: 10,
    });
  });
});
