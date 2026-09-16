import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { Community } from '../community/entities/community.entity';
import {
  CommunityProfile,
  CommunityProfileRole,
} from '../community/entities/community-profile.entity';
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
  const usersService = {
    findById: jest.fn(),
  };
  const communityService = {
    findUserCommunities: jest.fn(),
  };

  const service = new UserCommunitiesService(
    communityRepository as unknown as Repository<Community>,
    communityProfileRepository as unknown as Repository<CommunityProfile>,
    usersService as unknown as UsersService,
    communityService as unknown as CommunityService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('joinCommunity', () => {
    it('creates a MEMBER profile with the authenticated user data', async () => {
      communityRepository.findBy.mockResolvedValue([{ id: 5 }]);
      communityProfileRepository.findOne.mockResolvedValue(null);
      usersService.findById.mockResolvedValue({
        id: 'user-id',
        username: 'collector',
      });

      const profile = await service.joinCommunity('user-id', 5);

      expect(profile).toMatchObject({
        userId: 'user-id',
        communityId: 5,
        displayName: 'collector',
        bio: '',
        role: CommunityProfileRole.MEMBER,
      });
      expect(communityProfileRepository.save).toHaveBeenCalledWith(profile);
    });

    it.each([
      CommunityProfileRole.MEMBER,
      CommunityProfileRole.MODERATOR,
      CommunityProfileRole.OWNER,
    ])(
      'rejects a repeated join for an existing %s profile without changing it',
      async (role) => {
        const existingProfile = {
          communityProfileId: 10,
          userId: 'user-id',
          communityId: 5,
          role,
        } as CommunityProfile;
        communityRepository.findBy.mockResolvedValue([{ id: 5 }]);
        communityProfileRepository.findOne.mockResolvedValue(existingProfile);

        await expect(service.joinCommunity('user-id', 5)).rejects.toMatchObject(
          {
            response: {
              statusCode: 409,
              message: 'Ya perteneces a esta comunidad',
            },
          },
        );

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
      communityRepository.findBy.mockResolvedValue([{ id: 5 }]);
      communityProfileRepository.find.mockResolvedValue([existingProfile]);

      await expect(service.joinCommunities('user-id', [5])).resolves.toEqual([
        existingProfile,
      ]);

      expect(communityProfileRepository.save).not.toHaveBeenCalled();
      expect(existingProfile.role).toBe(CommunityProfileRole.MEMBER);
    });

    it('converts a concurrent unique violation to ConflictException', async () => {
      communityRepository.findBy.mockResolvedValue([{ id: 5 }]);
      communityProfileRepository.findOne.mockResolvedValue(null);
      usersService.findById.mockResolvedValue({
        id: 'user-id',
        username: 'collector',
      });
      communityProfileRepository.save.mockRejectedValueOnce(
        new QueryFailedError('INSERT', [], { code: '23505' }),
      );

      await expect(service.joinCommunity('user-id', 5)).rejects.toMatchObject({
        response: {
          statusCode: 409,
          message: 'Ya perteneces a esta comunidad',
        },
      });
    });

    it('rejects when the community does not exist', async () => {
      communityRepository.findBy.mockResolvedValue([]);

      await expect(service.joinCommunity('user-id', 999)).rejects.toThrow(
        NotFoundException,
      );
      expect(communityProfileRepository.save).not.toHaveBeenCalled();
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

    it('rejects a missing community or membership', async () => {
      communityRepository.findOne.mockResolvedValue(null);
      await expect(service.leaveCommunity('user-id', 999)).rejects.toThrow(
        NotFoundException,
      );

      communityRepository.findOne.mockResolvedValue({ id: 5 });
      communityProfileRepository.findOne.mockResolvedValue(null);
      await expect(service.leaveCommunity('user-id', 5)).rejects.toThrow(
        'No perteneces a esta comunidad',
      );
    });
  });
});
