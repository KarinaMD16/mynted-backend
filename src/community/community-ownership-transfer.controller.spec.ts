import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CommunityController } from './community.controller';
import { CommunityRoleGuard } from './guards/community-role.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('CommunityController ownership transfer', () => {
  it('protects the transfer endpoint with JWT and community role guards', async () => {
    const service = {
      transferCommunityOwnership: jest.fn().mockResolvedValue({}),
    };
    const controller = new CommunityController(service as never, {} as never);
    const method = Object.getOwnPropertyDescriptor(
      CommunityController.prototype,
      'transferCommunityOwnership',
    )?.value as (...args: never[]) => unknown;
    const guards = Reflect.getMetadata(GUARDS_METADATA, method) as unknown[];

    await controller.transferCommunityOwnership(2, { profileId: 123 }, {
      user: { userId: 'owner-id' },
    } as never);

    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, CommunityRoleGuard]),
    );
    expect(service.transferCommunityOwnership).toHaveBeenCalledWith(
      2,
      123,
      'owner-id',
    );
  });
});
