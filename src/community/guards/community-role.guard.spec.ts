import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Repository } from 'typeorm';
import { CommunityRoleGuard } from './community-role.guard';
import { COMMUNITY_ROLES_KEY } from '../decorators/require-community-role.decorator';
import {
  CommunityProfile,
  CommunityProfileRole,
} from '../entities/community-profile.entity';
import { Community } from '../entities/community.entity';

describe('CommunityRoleGuard', () => {
  const communityProfileRepository = { findOne: jest.fn() };
  const communityRepository = { findOne: jest.fn() };
  const reflector = { get: jest.fn() };
  const guard = new CommunityRoleGuard(
    reflector as unknown as Reflector,
    communityProfileRepository as unknown as Repository<CommunityProfile>,
    communityRepository as unknown as Repository<Community>,
  );

  const buildContext = (
    userId: string,
    communityId: string,
  ): ExecutionContext =>
    ({
      getHandler: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          user: { userId },
          params: { communityId },
        }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows the request through when no @RequireCommunityRole is set', async () => {
    reflector.get.mockReturnValue(undefined);

    await expect(guard.canActivate(buildContext('u1', '5'))).resolves.toBe(
      true,
    );
    expect(communityProfileRepository.findOne).not.toHaveBeenCalled();
    expect(communityRepository.findOne).not.toHaveBeenCalled();
  });

  it('allows a user whose role is in the allowed list', async () => {
    reflector.get.mockReturnValue([CommunityProfileRole.OWNER]);
    communityProfileRepository.findOne.mockResolvedValue({
      role: CommunityProfileRole.OWNER,
    });

    await expect(guard.canActivate(buildContext('u1', '5'))).resolves.toBe(
      true,
    );
    expect(communityProfileRepository.findOne).toHaveBeenCalledWith({
      where: { userId: 'u1', communityId: 5 },
    });
    expect(communityRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects a user with no communityProfile in that community', async () => {
    reflector.get.mockReturnValue([CommunityProfileRole.OWNER]);
    communityProfileRepository.findOne.mockResolvedValue(null);
    communityRepository.findOne.mockResolvedValue({ id: 5 });

    await expect(guard.canActivate(buildContext('u1', '5'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects a user whose role is not in the allowed list', async () => {
    reflector.get.mockReturnValue([CommunityProfileRole.OWNER]);
    communityProfileRepository.findOne.mockResolvedValue({
      role: CommunityProfileRole.MEMBER,
    });
    communityRepository.findOne.mockResolvedValue({ id: 5 });

    await expect(guard.canActivate(buildContext('u1', '5'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects with NotFoundException when the community does not exist at all', async () => {
    reflector.get.mockReturnValue([CommunityProfileRole.OWNER]);
    communityProfileRepository.findOne.mockResolvedValue(null);
    communityRepository.findOne.mockResolvedValue(null);

    await expect(guard.canActivate(buildContext('u1', '999'))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('reads the metadata key from the decorator', async () => {
    reflector.get.mockReturnValue([CommunityProfileRole.OWNER]);
    communityProfileRepository.findOne.mockResolvedValue({
      role: CommunityProfileRole.OWNER,
    });

    await guard.canActivate(buildContext('u1', '5'));

    expect(reflector.get).toHaveBeenCalledWith(
      COMMUNITY_ROLES_KEY,
      expect.any(Function),
    );
  });
});
