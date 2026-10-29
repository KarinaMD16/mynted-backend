/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/require-await */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UsersService } from '../users/users.service';
import { CommunityService } from './community.service';
import { Category } from './entities/category.entity';
import { Community } from './entities/community.entity';
import {
  CommunityProfile,
  CommunityProfileRole,
} from './entities/community-profile.entity';
import { CommunityRule } from './entities/community-rule.entity';
import { CommunityJoinRequest } from './entities/community-join-request.entity';
import { Tag } from './entities/tag.entity';
import { User, UserRole } from '../users/entities/user.entity';

describe('CommunityService.removeCommunityMember', () => {
  const communityRepository = {};
  const profileRepository = {};
  const moderationActionsService = { record: jest.fn() };
  const notificationsService = { notify: jest.fn().mockResolvedValue([]) };
  const managerRepositories = new Map<unknown, any>();
  const manager = {
    getRepository: jest.fn((entity: unknown) =>
      managerRepositories.get(entity),
    ),
  };
  const dataSource = {
    transaction: jest.fn(async (callback: (manager: any) => unknown) =>
      callback(manager),
    ),
  };
  const service = new CommunityService(
    communityRepository as Repository<Community>,
    {} as Repository<Category>,
    {} as Repository<Tag>,
    {} as Repository<CommunityRule>,
    dataSource as never,
    {} as CloudinaryService,
    {} as UsersService,
    profileRepository as Repository<CommunityProfile>,
    {} as Repository<CommunityJoinRequest>,
    {} as Repository<any>,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    notificationsService as never,
    moderationActionsService as never,
  );

  const communityManager = { findOne: jest.fn() };
  const profileManager = {
    findOne: jest.fn(),
    save: jest.fn((profile) => profile),
  };
  const userManager = { findOne: jest.fn() };
  const requestManager = { delete: jest.fn() };

  beforeAll(() => {
    managerRepositories.set(Community, communityManager);
    managerRepositories.set(CommunityProfile, profileManager);
    managerRepositories.set(User, userManager);
    managerRepositories.set(CommunityJoinRequest, requestManager);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    communityManager.findOne.mockResolvedValue({
      id: 2,
      name: 'Comunidad',
      slug: 'comunidad',
    });
    userManager.findOne
      .mockResolvedValueOnce({ id: 'actor', role: UserRole.SUPERADMIN })
      .mockResolvedValueOnce({ id: 'target', deletedAt: null });
    profileManager.findOne.mockResolvedValue({
      communityProfileId: 18,
      userId: 'target',
      communityId: 2,
      role: CommunityProfileRole.MEMBER,
      removedAt: null,
    });
  });

  it('finaliza la membresía, conserva el perfil y registra/notifica', async () => {
    await expect(
      service.removeCommunityMember(2, 18, 'actor', 'Incumplimiento'),
    ).resolves.toEqual({ message: 'Miembro expulsado correctamente' });

    expect(profileManager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        removedAt: expect.any(Date),
        role: CommunityProfileRole.MEMBER,
      }),
    );
    expect(moderationActionsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'actor',
        targetType: 'community_profile',
        targetId: 18,
        action: 'community_member_removed',
        communityId: 2,
        reason: 'Incumplimiento',
      }),
      manager,
    );
    expect(notificationsService.notify).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'target',
        data: expect.objectContaining({
          communityId: 2,
          reason: 'Incumplimiento',
        }),
      }),
    ]);
  });

  it('rechaza un perfil ya removido', async () => {
    profileManager.findOne.mockResolvedValue({
      communityProfileId: 18,
      userId: 'target',
      role: CommunityProfileRole.MEMBER,
      removedAt: new Date(),
    });

    await expect(
      service.removeCommunityMember(2, 18, 'actor', 'Motivo'),
    ).rejects.toThrow(NotFoundException);
  });

  it('rechaza un usuario objetivo soft-deleted', async () => {
    userManager.findOne.mockReset();
    userManager.findOne
      .mockResolvedValueOnce({ id: 'actor', role: UserRole.SUPERADMIN })
      .mockResolvedValueOnce({ id: 'target', deletedAt: new Date() });

    await expect(
      service.removeCommunityMember(2, 18, 'actor', 'Motivo'),
    ).rejects.toThrow(NotFoundException);
    expect(notificationsService.notify).not.toHaveBeenCalled();
  });

  it('permite que OWNER expulse un moderator, pero no que un moderator expulse otro moderator', async () => {
    userManager.findOne.mockReset();
    userManager.findOne
      .mockResolvedValueOnce({ id: 'owner', role: UserRole.USER })
      .mockResolvedValueOnce({ id: 'target', deletedAt: null });
    profileManager.findOne
      .mockResolvedValueOnce({
        communityProfileId: 18,
        userId: 'target',
        communityId: 2,
        role: CommunityProfileRole.MODERATOR,
        removedAt: null,
      })
      .mockResolvedValueOnce({
        communityProfileId: 1,
        userId: 'owner',
        communityId: 2,
        role: CommunityProfileRole.OWNER,
        removedAt: null,
      });

    await expect(
      service.removeCommunityMember(2, 18, 'owner', 'Motivo'),
    ).resolves.toBeDefined();

    userManager.findOne.mockReset();
    userManager.findOne
      .mockResolvedValueOnce({ id: 'moderator', role: UserRole.USER })
      .mockResolvedValueOnce({ id: 'target', deletedAt: null });
    profileManager.findOne
      .mockResolvedValueOnce({
        communityProfileId: 18,
        userId: 'target',
        communityId: 2,
        role: CommunityProfileRole.MODERATOR,
        removedAt: null,
      })
      .mockResolvedValueOnce({
        communityProfileId: 3,
        userId: 'moderator',
        communityId: 2,
        role: CommunityProfileRole.MODERATOR,
        removedAt: null,
      });

    await expect(
      service.removeCommunityMember(2, 18, 'moderator', 'Motivo'),
    ).rejects.toThrow(ForbiddenException);
  });
});
