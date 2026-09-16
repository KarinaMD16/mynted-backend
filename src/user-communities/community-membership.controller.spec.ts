import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CommunityMembershipController } from './community-membership.controller';

describe('CommunityMembershipController', () => {
  it('protects join and leave with JwtAuthGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      CommunityMembershipController,
    ) as unknown[];

    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard]));
  });
});
