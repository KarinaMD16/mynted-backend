/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { CommunityService } from './community.service';
import { Community } from './entities/community.entity';
import {
  CommunityProfile,
  CommunityProfileRole,
} from './entities/community-profile.entity';
import { CommunityJoinRequest } from './entities/community-join-request.entity';
import { CommunityBan } from './entities/community-ban.entity';
import { Category } from './entities/category.entity';
import { Tag } from './entities/tag.entity';
import { CommunityRule } from './entities/community-rule.entity';
import { Post } from './entities/post.entity';
import { User, UserRole } from '../users/entities/user.entity';

describe('CommunityService.transferCommunityOwnership', () => {
  const communityId = 2;
  const actorId = '00000000-0000-0000-0000-000000000001';
  const targetId = '00000000-0000-0000-0000-000000000002';
  const actorProfile = {
    communityProfileId: 10,
    userId: actorId,
    communityId,
    role: CommunityProfileRole.OWNER,
    removedAt: null,
    joinedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as CommunityProfile;

  function buildService(options?: {
    targetRole?: CommunityProfileRole;
    targetRemovedAt?: Date | null;
    actorRole?: UserRole;
    targetActive?: boolean;
    targetDeleted?: Date | null;
    activeBan?: boolean;
    targetProfileId?: number;
    targetCommunityId?: number;
  }) {
    const targetProfile = {
      communityProfileId: options?.targetProfileId ?? 11,
      userId: targetId,
      communityId: options?.targetCommunityId ?? communityId,
      role: options?.targetRole ?? CommunityProfileRole.MEMBER,
      removedAt: options?.targetRemovedAt ?? null,
      joinedAt: new Date('2026-01-02T00:00:00.000Z'),
    } as CommunityProfile;
    const community = { id: communityId, isActive: false } as Community;
    const profileRepository = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([actorProfile]),
      save: jest.fn(async (profile) => profile),
    };
    profileRepository.findOne.mockImplementation(
      async (args: {
        where: { userId?: string; communityProfileId?: number };
      }) => {
        if (args.where.userId === actorId) return actorProfile;
        if (
          args.where.communityProfileId === targetProfile.communityProfileId
        ) {
          return targetProfile;
        }
        return null;
      },
    );
    const banRepository = {
      findOne: jest
        .fn()
        .mockResolvedValue(options?.activeBan ? { isActive: true } : null),
    };
    const communityRepository = {
      findOne: jest.fn().mockResolvedValue(community),
    };
    const userRepository = {
      findOne: jest.fn(async (args: { where: { id: string } }) =>
        args.where.id === actorId
          ? {
              id: actorId,
              role: options?.actorRole ?? UserRole.USER,
              isActive: true,
              deletedAt: null,
            }
          : {
              id: targetId,
              isActive: options?.targetActive ?? true,
              deletedAt: options?.targetDeleted ?? null,
            },
      ),
    };
    const requestRepository = {};
    const moderationActionsService = { record: jest.fn() };
    const notificationsService = { notify: jest.fn() };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === Community) return communityRepository;
        if (entity === CommunityProfile) return profileRepository;
        if (entity === CommunityBan) return banRepository;
        if (entity === CommunityJoinRequest) return requestRepository;
        if (entity === User) return userRepository;
        throw new Error('Unexpected repository');
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const service = new CommunityService(
      {} as Repository<Community>,
      {} as Repository<Category>,
      {} as Repository<Tag>,
      {} as Repository<CommunityRule>,
      dataSource as never,
      {} as never,
      {} as never,
      profileRepository as never,
      {} as never,
      {} as Repository<Post>,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      notificationsService as never,
      moderationActionsService as never,
      banRepository as never,
    );
    return {
      service,
      actorProfile,
      targetProfile,
      profileRepository,
      moderationActionsService,
      notificationsService,
    };
  }

  it('transfers ownership from MEMBER and preserves profile state', async () => {
    const context = buildService();
    const actorJoinedAt = context.actorProfile.joinedAt;
    const targetJoinedAt = context.targetProfile.joinedAt;

    await expect(
      context.service.transferCommunityOwnership(
        communityId,
        context.targetProfile.communityProfileId,
        actorId,
      ),
    ).resolves.toEqual({
      message: 'Propiedad de la comunidad transferida correctamente',
    });

    expect(context.actorProfile.role).toBe(CommunityProfileRole.MODERATOR);
    expect(context.targetProfile.role).toBe(CommunityProfileRole.OWNER);
    expect(context.actorProfile.joinedAt).toBe(actorJoinedAt);
    expect(context.targetProfile.joinedAt).toBe(targetJoinedAt);
    expect(context.actorProfile.removedAt).toBeNull();
    expect(context.targetProfile.removedAt).toBeNull();
    expect(context.profileRepository.save).toHaveBeenNthCalledWith(
      1,
      context.actorProfile,
    );
    expect(context.profileRepository.save).toHaveBeenNthCalledWith(
      2,
      context.targetProfile,
    );
    expect(context.moderationActionsService.record).toHaveBeenCalledWith(
      {
        actorUserId: actorId,
        targetType: 'community',
        targetId: String(communityId),
        action: 'community_ownership_transferred',
        reason: null,
        communityId,
      },
      expect.anything(),
    );
  });

  it('transfers ownership from MODERATOR', async () => {
    const context = buildService({
      targetRole: CommunityProfileRole.MODERATOR,
    });

    await context.service.transferCommunityOwnership(
      communityId,
      context.targetProfile.communityProfileId,
      actorId,
    );

    expect(context.actorProfile.role).toBe(CommunityProfileRole.MODERATOR);
    expect(context.targetProfile.role).toBe(CommunityProfileRole.OWNER);
  });

  it('does not send moderator notifications during ownership transfer', async () => {
    const context = buildService();

    await context.service.transferCommunityOwnership(
      communityId,
      context.targetProfile.communityProfileId,
      actorId,
    );

    expect(context.notificationsService.notify).not.toHaveBeenCalled();
  });

  it('rejects SUPERADMIN without a real OWNER profile', async () => {
    const context = buildService({ actorRole: UserRole.SUPERADMIN });
    context.profileRepository.findOne.mockResolvedValue(null);

    await expect(
      context.service.transferCommunityOwnership(
        communityId,
        context.targetProfile.communityProfileId,
        actorId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects self transfer', async () => {
    const context = buildService({
      targetProfileId: actorProfile.communityProfileId,
    });
    context.profileRepository.findOne.mockImplementation(
      async (args: {
        where: { userId?: string; communityProfileId?: number };
      }) =>
        args.where.userId === actorId ||
        args.where.communityProfileId === actorProfile.communityProfileId
          ? actorProfile
          : null,
    );

    await expect(
      context.service.transferCommunityOwnership(
        communityId,
        actorProfile.communityProfileId,
        actorId,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects removed, inactive and banned targets', async () => {
    await expect(
      buildService({
        targetRemovedAt: new Date(),
      }).service.transferCommunityOwnership(communityId, 11, actorId),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      buildService({ targetActive: false }).service.transferCommunityOwnership(
        communityId,
        11,
        actorId,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      buildService({ activeBan: true }).service.transferCommunityOwnership(
        communityId,
        11,
        actorId,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      buildService({
        targetDeleted: new Date(),
      }).service.transferCommunityOwnership(communityId, 11, actorId),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      buildService({
        targetCommunityId: 99,
      }).service.transferCommunityOwnership(communityId, 11, actorId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
