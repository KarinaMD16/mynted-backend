import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { Community } from '../community/entities/community.entity';
import {
  CommunityProfile,
  CommunityProfileRole,
} from '../community/entities/community-profile.entity';
import {
  CommunityJoinRequest,
  CommunityJoinRequestStatus,
} from '../community/entities/community-join-request.entity';
import { UserTag } from '../user-tags/entities/user-tag.entity';
import { UserCommunitiesService } from './user-communities.service';
import { CommunityService } from '../community/community.service';

/* eslint-disable @typescript-eslint/no-unsafe-return */

describe('UserCommunitiesService', () => {
  const communityRepository = {
    findBy: jest.fn(),
    findOne: jest.fn(),
  };
  const communityProfileRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((values) => values),
    save: jest.fn((value) => Promise.resolve(value)),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const communityJoinRequestRepository = {
    findOne: jest.fn(),
    create: jest.fn((values) => values),
    save: jest.fn((value) => Promise.resolve(value)),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const userTagRepository = {
    find: jest.fn(),
  };
  const usersService = {
    findById: jest.fn(),
  };
  const communityService = {
    findUserCommunities: jest.fn(),
  };

  const service = new UserCommunitiesService(
    communityRepository as unknown as Repository<Community>,
    communityProfileRepository as unknown as Repository<CommunityProfile>,
    communityJoinRequestRepository as unknown as Repository<CommunityJoinRequest>,
    userTagRepository as unknown as Repository<UserTag>,
    usersService as unknown as UsersService,
    communityService as unknown as CommunityService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('joinCommunity — public community', () => {
    it('creates a MEMBER profile with the authenticated user data', async () => {
      communityRepository.findOne.mockResolvedValue({
        id: 5,
        isPrivate: false,
      });
      communityProfileRepository.findOne.mockResolvedValue(null);
      usersService.findById.mockResolvedValue({
        id: 'user-id',
        username: 'collector',
      });

      await expect(service.joinCommunity('user-id', 5)).resolves.toEqual({
        communityId: 5,
        result: 'joined',
      });

      expect(communityProfileRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-id',
          communityId: 5,
          displayName: 'collector',
          bio: '',
          role: CommunityProfileRole.MEMBER,
        }),
      );
    });

    it.each([
      CommunityProfileRole.MEMBER,
      CommunityProfileRole.MODERATOR,
      CommunityProfileRole.OWNER,
    ])(
      'returns already_member for a repeated join with an existing %s profile, without changing it',
      async (role) => {
        const existingProfile = {
          communityProfileId: 10,
          userId: 'user-id',
          communityId: 5,
          role,
        } as CommunityProfile;
        communityRepository.findOne.mockResolvedValue({
          id: 5,
          isPrivate: false,
        });
        communityProfileRepository.findOne.mockResolvedValue(existingProfile);

        await expect(service.joinCommunity('user-id', 5)).resolves.toEqual({
          communityId: 5,
          result: 'already_member',
        });

        expect(communityProfileRepository.save).not.toHaveBeenCalled();
        expect(communityProfileRepository.create).not.toHaveBeenCalled();
        expect(usersService.findById).not.toHaveBeenCalled();
        expect(existingProfile.role).toBe(role);
      },
    );

    it('keeps onboarding idempotent for an existing profile', async () => {
      const existingProfile = {
        communityProfileId: 10,
        userId: 'user-id',
        communityId: 5,
        role: CommunityProfileRole.MEMBER,
      } as CommunityProfile;
      communityRepository.findBy.mockResolvedValue([
        { id: 5, isPrivate: false },
      ]);
      communityProfileRepository.findOne.mockResolvedValue(existingProfile);

      await expect(service.joinCommunities('user-id', [5])).resolves.toEqual([
        { communityId: 5, result: 'already_member' },
      ]);

      expect(communityProfileRepository.save).not.toHaveBeenCalled();
      expect(existingProfile.role).toBe(CommunityProfileRole.MEMBER);
    });

    it('returns already_member on a concurrent unique violation', async () => {
      communityRepository.findOne.mockResolvedValue({
        id: 5,
        isPrivate: false,
      });
      communityProfileRepository.findOne.mockResolvedValue(null);
      usersService.findById.mockResolvedValue({
        id: 'user-id',
        username: 'collector',
      });
      communityProfileRepository.save.mockRejectedValueOnce(
        new QueryFailedError('INSERT', [], { code: '23505' }),
      );

      await expect(service.joinCommunity('user-id', 5)).resolves.toEqual({
        communityId: 5,
        result: 'already_member',
      });
    });

    it('rejects when the community does not exist', async () => {
      communityRepository.findOne.mockResolvedValue(null);

      await expect(service.joinCommunity('user-id', 999)).rejects.toThrow(
        NotFoundException,
      );
      expect(communityProfileRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('joinCommunity — private community', () => {
    it('creates a pending communityJoinRequest instead of a profile', async () => {
      communityRepository.findOne.mockResolvedValue({ id: 6, isPrivate: true });
      communityProfileRepository.findOne.mockResolvedValue(null);
      communityJoinRequestRepository.findOne.mockResolvedValue(null);

      await expect(service.joinCommunity('user-id', 6)).resolves.toEqual({
        communityId: 6,
        result: 'requested',
      });

      expect(communityJoinRequestRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-id',
          communityId: 6,
          status: CommunityJoinRequestStatus.PENDING,
        }),
      );
      expect(communityProfileRepository.save).not.toHaveBeenCalled();
    });

    it('returns already_requested for a repeated pending request', async () => {
      communityRepository.findOne.mockResolvedValue({ id: 6, isPrivate: true });
      communityProfileRepository.findOne.mockResolvedValue(null);
      communityJoinRequestRepository.findOne.mockResolvedValue({
        id: 1,
        userId: 'user-id',
        communityId: 6,
        status: CommunityJoinRequestStatus.PENDING,
      });

      await expect(service.joinCommunity('user-id', 6)).resolves.toEqual({
        communityId: 6,
        result: 'already_requested',
      });

      expect(communityJoinRequestRepository.save).not.toHaveBeenCalled();
    });

    it('returns already_requested on a concurrent unique violation', async () => {
      communityRepository.findOne.mockResolvedValue({ id: 6, isPrivate: true });
      communityProfileRepository.findOne.mockResolvedValue(null);
      communityJoinRequestRepository.findOne.mockResolvedValue(null);
      communityJoinRequestRepository.save.mockRejectedValueOnce(
        new QueryFailedError('INSERT', [], { code: '23505' }),
      );

      await expect(service.joinCommunity('user-id', 6)).resolves.toEqual({
        communityId: 6,
        result: 'already_requested',
      });
    });

    it('prefers already_member over creating a request if a profile already exists', async () => {
      communityRepository.findOne.mockResolvedValue({ id: 6, isPrivate: true });
      communityProfileRepository.findOne.mockResolvedValue({
        communityProfileId: 1,
        userId: 'user-id',
        communityId: 6,
        role: CommunityProfileRole.MEMBER,
      });

      await expect(service.joinCommunity('user-id', 6)).resolves.toEqual({
        communityId: 6,
        result: 'already_member',
      });

      expect(communityJoinRequestRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('leaveCommunity', () => {
    it('removes a MEMBER profile only', async () => {
      const member = {
        communityProfileId: 10,
        userId: 'user-id',
        communityId: 5,
        role: CommunityProfileRole.MEMBER,
      } as CommunityProfile;
      communityRepository.findOne.mockResolvedValue({ id: 5 });
      communityProfileRepository.findOne.mockResolvedValue(member);

      await expect(service.leaveCommunity('user-id', 5)).resolves.toEqual({
        message: 'Has abandonado la comunidad correctamente',
      });
      expect(communityProfileRepository.remove).toHaveBeenCalledWith(member);
      expect(usersService.findById).not.toHaveBeenCalled();
    });

    it('removes a MODERATOR profile without changing global seller data', async () => {
      const moderator = {
        communityProfileId: 10,
        userId: 'seller-id',
        communityId: 5,
        role: CommunityProfileRole.MODERATOR,
      } as CommunityProfile;
      communityRepository.findOne.mockResolvedValue({ id: 5 });
      communityProfileRepository.findOne.mockResolvedValue(moderator);

      await service.leaveCommunity('seller-id', 5);

      expect(communityProfileRepository.remove).toHaveBeenCalledWith(moderator);
      expect(usersService.findById).not.toHaveBeenCalled();
    });

    it('rejects an OWNER and does not remove the profile', async () => {
      const owner = {
        communityProfileId: 10,
        userId: 'user-id',
        communityId: 5,
        role: CommunityProfileRole.OWNER,
      } as CommunityProfile;
      communityRepository.findOne.mockResolvedValue({ id: 5 });
      communityProfileRepository.findOne.mockResolvedValue(owner);

      await expect(service.leaveCommunity('user-id', 5)).rejects.toThrow(
        ConflictException,
      );
      expect(communityProfileRepository.remove).not.toHaveBeenCalled();
    });

    it('cancels a pending join request when there is no profile', async () => {
      const pendingRequest = {
        id: 1,
        userId: 'user-id',
        communityId: 6,
        status: CommunityJoinRequestStatus.PENDING,
      };
      communityRepository.findOne.mockResolvedValue({ id: 6 });
      communityProfileRepository.findOne.mockResolvedValue(null);
      communityJoinRequestRepository.findOne.mockResolvedValue(pendingRequest);

      await expect(service.leaveCommunity('user-id', 6)).resolves.toEqual({
        message: 'Solicitud de unión cancelada correctamente',
      });
      expect(communityJoinRequestRepository.remove).toHaveBeenCalledWith(
        pendingRequest,
      );
    });

    it('rejects a missing community, membership or pending request', async () => {
      communityRepository.findOne.mockResolvedValue(null);
      await expect(service.leaveCommunity('user-id', 999)).rejects.toThrow(
        NotFoundException,
      );

      communityRepository.findOne.mockResolvedValue({ id: 5 });
      communityProfileRepository.findOne.mockResolvedValue(null);
      communityJoinRequestRepository.findOne.mockResolvedValue(null);
      await expect(service.leaveCommunity('user-id', 5)).rejects.toThrow(
        'No perteneces a esta comunidad',
      );
    });
  });
});
