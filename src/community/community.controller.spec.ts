import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CommunityController } from './community.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CommunityRoleGuard } from './guards/community-role.guard';
import { ModerationItemType } from '../moderation/enums/moderation-item-type.enum';

describe('CommunityController', () => {
  it('protects POST /communities with JwtAuthGuard', () => {
    const createMethod = Object.getOwnPropertyDescriptor(
      CommunityController.prototype,
      'create',
    )?.value as (...args: never[]) => unknown;
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      createMethod,
    ) as unknown[];

    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard]));
  });

  it('passes the authenticated user to the community detail service', async () => {
    const communityService = {
      findCommunityDetail: jest.fn().mockResolvedValue({}),
    };
    const controller = new CommunityController(
      communityService as never,
      {} as never,
    );
    const request = { user: { userId: 'user-id' } };

    await controller.findCommunityDetail(7, request as never);

    expect(communityService.findCommunityDetail).toHaveBeenCalledWith(
      7,
      'user-id',
    );
  });

  it('protects and passes the authenticated user to the slug detail endpoint', async () => {
    const communityService = {
      findCommunityDetailBySlug: jest.fn().mockResolvedValue({}),
    };
    const controller = new CommunityController(
      communityService as never,
      {} as never,
    );
    const request = { user: { userId: 'user-id' } };
    const method = Object.getOwnPropertyDescriptor(
      CommunityController.prototype,
      'findCommunityDetailBySlug',
    )?.value as (...args: never[]) => unknown;
    const guards = Reflect.getMetadata(GUARDS_METADATA, method) as unknown[];

    await controller.findCommunityDetailBySlug('pokemon', request as never);

    expect(guards).toEqual(expect.arrayContaining([OptionalJwtAuthGuard]));
    expect(communityService.findCommunityDetailBySlug).toHaveBeenCalledWith(
      'pokemon',
      'user-id',
    );
  });

  it('protects the administrative community list with JWT and SuperAdminGuard', async () => {
    const communityService = {
      findAllCommunitiesForAdmin: jest.fn().mockResolvedValue({ data: [] }),
    };
    const controller = new CommunityController(
      communityService as never,
      {} as never,
    );
    const method = Object.getOwnPropertyDescriptor(
      CommunityController.prototype,
      'findAllCommunitiesForAdmin',
    )?.value as (...args: never[]) => unknown;
    const guards = Reflect.getMetadata(GUARDS_METADATA, method) as unknown[];
    const query = { page: 1, limit: 10 };

    await controller.findAllCommunitiesForAdmin(query);

    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, SuperAdminGuard]),
    );
    expect(communityService.findAllCommunitiesForAdmin).toHaveBeenCalledWith(
      query,
    );
  });

  it('protects the community stats endpoint and passes the community id', async () => {
    const communityService = {
      getStats: jest.fn().mockResolvedValue({}),
    };
    const controller = new CommunityController(
      communityService as never,
      {} as never,
    );
    const method = Object.getOwnPropertyDescriptor(
      CommunityController.prototype,
      'getCommunityStats',
    )?.value as (...args: never[]) => unknown;
    const guards = Reflect.getMetadata(GUARDS_METADATA, method) as unknown[];

    await controller.getCommunityStats(7);

    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard]));
    expect(communityService.getStats).toHaveBeenCalledWith(7);
  });

  it('protects the community members endpoint with community roles', async () => {
    const communityService = {
      findCommunityMembers: jest.fn().mockResolvedValue({ data: [] }),
    };
    const controller = new CommunityController(
      communityService as never,
      {} as never,
    );
    const method = Object.getOwnPropertyDescriptor(
      CommunityController.prototype,
      'findCommunityMembers',
    )?.value as (...args: never[]) => unknown;
    const guards = Reflect.getMetadata(GUARDS_METADATA, method) as unknown[];

    await controller.findCommunityMembers(2, { page: 1, limit: 20 });

    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, CommunityRoleGuard]),
    );
    expect(communityService.findCommunityMembers).toHaveBeenCalledWith(2, {
      page: 1,
      limit: 20,
    });
  });

  it('protects the member removal endpoint and passes the reason and actor', async () => {
    const communityService = {
      removeCommunityMember: jest.fn().mockResolvedValue({
        message: 'Miembro expulsado correctamente',
      }),
    };
    const controller = new CommunityController(
      communityService as never,
      {} as never,
    );
    const method = Object.getOwnPropertyDescriptor(
      CommunityController.prototype,
      'removeCommunityMember',
    )?.value as (...args: never[]) => unknown;
    const guards = Reflect.getMetadata(GUARDS_METADATA, method) as unknown[];

    await controller.removeCommunityMember(
      2,
      18,
      { reason: 'Incumplimiento de reglas' },
      { user: { userId: 'actor-id' } } as never,
    );

    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, CommunityRoleGuard]),
    );
    expect(communityService.removeCommunityMember).toHaveBeenCalledWith(
      2,
      18,
      'actor-id',
      'Incumplimiento de reglas',
    );
  });

  it.each([
    'update',
    'deactivate',
    'activate',
    'makePublic',
    'makePrivate',
    'addModerator',
    'removeModerator',
  ])('protects administrative endpoint %s', (methodName) => {
    const method = Object.getOwnPropertyDescriptor(
      CommunityController.prototype,
      methodName,
    )?.value as (...args: never[]) => unknown;
    const guards = Reflect.getMetadata(GUARDS_METADATA, method) as unknown[];

    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard]));
  });

  it('protects community deletion with JWT and SuperAdminGuard', () => {
    const method = Object.getOwnPropertyDescriptor(
      CommunityController.prototype,
      'deleteCommunity',
    )?.value as (...args: never[]) => unknown;
    const guards = Reflect.getMetadata(GUARDS_METADATA, method) as unknown[];

    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, SuperAdminGuard]),
    );
  });

  it.each(['createCategory', 'activateCategory', 'deactivateCategory'])(
    'protects category endpoint %s with JwtAuthGuard and SuperAdminGuard',
    (methodName) => {
      const method = Object.getOwnPropertyDescriptor(
        CommunityController.prototype,
        methodName,
      )?.value as (...args: never[]) => unknown;
      const guards = Reflect.getMetadata(GUARDS_METADATA, method) as unknown[];

      expect(guards).toEqual(
        expect.arrayContaining([JwtAuthGuard, SuperAdminGuard]),
      );
    },
  );

  it('protects the inactive categories endpoint with JWT and SuperAdmin guards', async () => {
    const communityService = {
      findInactiveCategories: jest.fn().mockResolvedValue([]),
    };
    const controller = new CommunityController(
      communityService as never,
      {} as never,
    );
    const method = Object.getOwnPropertyDescriptor(
      CommunityController.prototype,
      'findInactiveCategories',
    )?.value as (...args: never[]) => unknown;
    const guards = Reflect.getMetadata(GUARDS_METADATA, method) as unknown[];

    await controller.findInactiveCategories();

    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, SuperAdminGuard]),
    );
    expect(communityService.findInactiveCategories).toHaveBeenCalled();
  });

  it('protects content restoration with JWT and community roles', async () => {
    const communityService = {};
    const moderationService = {
      restoreContent: jest.fn().mockResolvedValue({ isHidden: false }),
    };
    const controller = new CommunityController(
      communityService as never,
      moderationService as never,
    );
    const method = Object.getOwnPropertyDescriptor(
      CommunityController.prototype,
      'restoreModeratedContent',
    )?.value as (...args: never[]) => unknown;
    const guards = Reflect.getMetadata(GUARDS_METADATA, method) as unknown[];

    await controller.restoreModeratedContent(8, ModerationItemType.POST, 4, {
      user: { userId: 'owner-id' },
    } as never);

    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, CommunityRoleGuard]),
    );
    expect(moderationService.restoreContent).toHaveBeenCalledWith(
      ModerationItemType.POST,
      4,
      8,
      'owner-id',
    );
  });
});
