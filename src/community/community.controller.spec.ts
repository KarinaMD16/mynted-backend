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
});
