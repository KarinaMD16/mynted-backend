/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/no-unnecessary-type-assertion */
import { ForbiddenException, ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CommunityService } from './community.service';
import { CommunityBan } from './entities/community-ban.entity';
import {
  CommunityProfile,
  CommunityProfileRole,
} from './entities/community-profile.entity';
import { Community } from './entities/community.entity';
import { CommunityJoinRequest } from './entities/community-join-request.entity';
import { Category } from './entities/category.entity';
import { Tag } from './entities/tag.entity';
import { CommunityRule } from './entities/community-rule.entity';
import { Post } from './entities/post.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { CreateCommunityBanDto } from './dto/create-community-ban.dto';

describe('CommunityService community bans', () => {
  const actorId = '00000000-0000-0000-0000-000000000001';
  const targetId = '00000000-0000-0000-0000-000000000002';
  const community = { id: 2, isActive: false } as Community;

  function buildService(options?: {
    targetProfile?: Partial<CommunityProfile> | null;
    existingBan?: Partial<CommunityBan> | null;
    actorRole?: UserRole;
  }) {
    const targetProfile = options?.targetProfile ?? {
      userId: targetId,
      communityId: community.id,
      role: CommunityProfileRole.MEMBER,
      removedAt: null,
    };
    const existingBan = options?.existingBan ?? null;
    const actorRole = options?.actorRole ?? UserRole.USER;
    const saved: unknown[] = [];
    const profileRepository = {
      findOne: jest.fn(),
      save: jest.fn(async (profile) => profile),
      find: jest.fn(),
    };
    profileRepository.findOne.mockImplementation(
      async (args: { where: { userId: string } }) => {
        if (args.where.userId === targetId) return targetProfile;
        if (args.where.userId === actorId) {
          return {
            userId: actorId,
            communityId: community.id,
            role: CommunityProfileRole.OWNER,
            removedAt: null,
          };
        }
        return null;
      },
    );
    const banRepository = {
      findOne: jest.fn().mockResolvedValue(existingBan),
      create: jest.fn((values) => values),
      save: jest.fn(async (ban) => {
        saved.push(ban);
        return ban;
      }),
    };
    const requestRepository = { delete: jest.fn() };
    const userRepository = {
      findOne: jest.fn(async (args: { where: { id: string } }) =>
        args.where.id === actorId
          ? { id: actorId, role: actorRole }
          : { id: targetId, deletedAt: null, username: 'target' },
      ),
    };
    const communityRepository = {
      findOne: jest.fn().mockResolvedValue(community),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === Community) return communityRepository;
        if (entity === CommunityProfile) return profileRepository;
        if (entity === CommunityBan) return banRepository;
        if (entity === CommunityJoinRequest) return requestRepository;
        if (entity === User) return userRepository;
        throw new Error('Unexpected repository');
      }),
      create: jest.fn((_, values) => values),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const moderationActionsService = { record: jest.fn() };
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
      undefined,
      moderationActionsService as never,
      banRepository as never,
    );
    return {
      service,
      profileRepository,
      banRepository,
      requestRepository,
      moderationActionsService,
      saved,
    };
  }

  it('allows an owner to ban a member in an inactive community and audits it', async () => {
    const context = buildService();
    const dto = { userId: targetId, reason: 'Spam' } as CreateCommunityBanDto;

    await expect(
      context.service.createCommunityBan(community.id, dto, actorId),
    ).resolves.toEqual({ message: 'Usuario bloqueado correctamente' });

    expect(context.saved[0]).toMatchObject({
      communityId: community.id,
      userId: targetId,
      bannedByUserId: actorId,
      reason: 'Spam',
      isActive: true,
    });
    expect(context.profileRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        removedAt: expect.any(Date),
        role: CommunityProfileRole.MEMBER,
      }),
    );
    expect(context.requestRepository.delete).toHaveBeenCalled();
    expect(context.moderationActionsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'user',
        targetId,
        action: 'community_member_banned',
        communityId: community.id,
      }),
      expect.anything(),
    );
  });

  it('rejects an already active ban without saving another one', async () => {
    const context = buildService({ existingBan: { id: 4, isActive: true } });

    await expect(
      context.service.createCommunityBan(
        community.id,
        { userId: targetId, reason: 'Spam' } as CreateCommunityBanDto,
        actorId,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(context.banRepository.save).not.toHaveBeenCalled();
  });

  it('reuses an inactive ban row when banning again', async () => {
    const oldBan = {
      id: 4,
      communityId: community.id,
      userId: targetId,
      isActive: false,
      reason: 'Old reason',
      bannedByUserId: 'old-actor',
    };
    const context = buildService({ existingBan: oldBan });

    await context.service.createCommunityBan(
      community.id,
      { userId: targetId, reason: 'New reason' } as CreateCommunityBanDto,
      actorId,
    );

    expect(context.banRepository.create).not.toHaveBeenCalled();
    expect(oldBan).toMatchObject({
      id: 4,
      isActive: true,
      reason: 'New reason',
      bannedByUserId: actorId,
    });
  });

  it('deactivates a ban without restoring membership and audits the unban', async () => {
    const activeBan = {
      id: 4,
      communityId: community.id,
      userId: targetId,
      isActive: true,
      bannedByUserId: actorId,
    };
    const context = buildService({ existingBan: activeBan });

    await expect(
      context.service.removeCommunityBan(community.id, targetId, actorId),
    ).resolves.toEqual({ message: 'Bloqueo eliminado correctamente' });

    expect(activeBan.isActive).toBe(false);
    expect(context.moderationActionsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'community_member_unbanned',
        reason: null,
      }),
      expect.anything(),
    );
  });

  it('does not allow a moderator to ban another moderator', async () => {
    const context = buildService({
      targetProfile: {
        userId: targetId,
        communityId: community.id,
        role: CommunityProfileRole.MODERATOR,
        removedAt: null,
      },
    });
    context.profileRepository.findOne.mockImplementation(
      async (args: { where: { userId: string } }) =>
        args.where.userId === targetId
          ? {
              userId: targetId,
              communityId: community.id,
              role: CommunityProfileRole.MODERATOR,
              removedAt: null,
            }
          : {
              userId: actorId,
              communityId: community.id,
              role: CommunityProfileRole.MODERATOR,
              removedAt: null,
            },
    );

    await expect(
      context.service.createCommunityBan(
        community.id,
        { userId: targetId, reason: 'Abuse' } as CreateCommunityBanDto,
        actorId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
