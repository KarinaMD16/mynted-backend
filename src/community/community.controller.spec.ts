import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CommunityController } from './community.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

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
    const controller = new CommunityController(communityService as never);
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
    const controller = new CommunityController(communityService as never);
    const request = { user: { userId: 'user-id' } };
    const method = Object.getOwnPropertyDescriptor(
      CommunityController.prototype,
      'findCommunityDetailBySlug',
    )?.value as (...args: never[]) => unknown;
    const guards = Reflect.getMetadata(GUARDS_METADATA, method) as unknown[];

    await controller.findCommunityDetailBySlug('pokemon', request as never);

    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard]));
    expect(communityService.findCommunityDetailBySlug).toHaveBeenCalledWith(
      'pokemon',
      'user-id',
    );
  });

  it('protects the community stats endpoint and passes the community id', async () => {
    const communityService = {
      getStats: jest.fn().mockResolvedValue({}),
    };
    const controller = new CommunityController(communityService as never);
    const method = Object.getOwnPropertyDescriptor(
      CommunityController.prototype,
      'getCommunityStats',
    )?.value as (...args: never[]) => unknown;
    const guards = Reflect.getMetadata(GUARDS_METADATA, method) as unknown[];

    await controller.getCommunityStats(7);

    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard]));
    expect(communityService.getStats).toHaveBeenCalledWith(7);
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
});
