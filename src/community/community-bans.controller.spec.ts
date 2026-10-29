import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CommunityController } from './community.controller';
import { CommunityRoleGuard } from './guards/community-role.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('CommunityController community bans', () => {
  const service = {
    createCommunityBan: jest.fn().mockResolvedValue({}),
    findCommunityBans: jest.fn().mockResolvedValue({ data: [] }),
    removeCommunityBan: jest.fn().mockResolvedValue({}),
  };
  const controller = new CommunityController(service as never, {} as never);

  it.each(['createCommunityBan', 'findCommunityBans', 'removeCommunityBan'])(
    'protects %s with JWT and community role guards',
    (methodName) => {
      const method = Object.getOwnPropertyDescriptor(
        CommunityController.prototype,
        methodName,
      )?.value as (...args: never[]) => unknown;
      const guards = Reflect.getMetadata(GUARDS_METADATA, method) as unknown[];

      expect(guards).toEqual(
        expect.arrayContaining([JwtAuthGuard, CommunityRoleGuard]),
      );
    },
  );

  it('passes the actor and ban payload to the create service', async () => {
    await controller.createCommunityBan(
      2,
      { userId: 'target-id', reason: 'Spam' },
      { user: { userId: 'actor-id' } } as never,
    );

    expect(service.createCommunityBan).toHaveBeenCalledWith(
      2,
      { userId: 'target-id', reason: 'Spam' },
      'actor-id',
    );
  });

  it('passes pagination/search to the list service', async () => {
    await controller.findCommunityBans(2, {
      page: 1,
      limit: 20,
      search: 'nick',
    });

    expect(service.findCommunityBans).toHaveBeenCalledWith(2, {
      page: 1,
      limit: 20,
      search: 'nick',
    });
  });

  it('passes the target and actor to the unban service', async () => {
    await controller.removeCommunityBan(2, 'target-id', {
      user: { userId: 'actor-id' },
    } as never);

    expect(service.removeCommunityBan).toHaveBeenCalledWith(
      2,
      'target-id',
      'actor-id',
    );
  });
});
