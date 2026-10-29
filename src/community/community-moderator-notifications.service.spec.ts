/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CommunityService } from './community.service';
import { Community } from './entities/community.entity';
import {
  CommunityProfile,
  CommunityProfileRole,
} from './entities/community-profile.entity';
import { CommunityJoinRequest } from './entities/community-join-request.entity';
import { Category } from './entities/category.entity';
import { Tag } from './entities/tag.entity';
import { CommunityRule } from './entities/community-rule.entity';
import { Post } from './entities/post.entity';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UsersService } from '../users/users.service';
import { NotificationType } from '../notifications/enums/notification-type.enum';

describe('CommunityService moderator notifications', () => {
  const community = {
    id: 5,
    name: 'Collectors',
    slug: 'collectors',
  } as Community;
  const notificationsService = { notify: jest.fn() };
  const communityRepository = { findOne: jest.fn() };
  const profileRepository = {
    findOne: jest.fn(),
    save: jest.fn(async (profile) => profile),
  };
  const service = new CommunityService(
    communityRepository as unknown as Repository<Community>,
    {} as Repository<Category>,
    {} as Repository<Tag>,
    {} as Repository<CommunityRule>,
    {} as never,
    {} as CloudinaryService,
    {} as UsersService,
    profileRepository as unknown as Repository<CommunityProfile>,
    {} as Repository<CommunityJoinRequest>,
    {} as Repository<Post>,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    notificationsService as never,
    undefined,
    undefined,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    communityRepository.findOne.mockResolvedValue(community);
    notificationsService.notify.mockResolvedValue([]);
  });

  it('notifies only the promoted user after a successful promotion', async () => {
    const profile = {
      communityProfileId: 10,
      userId: 'member-id',
      communityId: community.id,
      role: CommunityProfileRole.MEMBER,
      removedAt: null,
    } as CommunityProfile;
    profileRepository.findOne.mockResolvedValue(profile);

    await service.addModerator(community.id, profile.communityProfileId);

    expect(profile.role).toBe(CommunityProfileRole.MODERATOR);
    expect(notificationsService.notify).toHaveBeenCalledTimes(1);
    expect(notificationsService.notify).toHaveBeenCalledWith([
      {
        userId: 'member-id',
        type: NotificationType.COMMUNITY_MODERATOR_ADDED,
        data: {
          communityId: 5,
          communityName: 'Collectors',
          communitySlug: 'collectors',
        },
        message: 'Has sido nombrado moderador de esta comunidad.',
      },
    ]);
  });

  it('notifies only the affected user after removing moderator role', async () => {
    const profile = {
      communityProfileId: 10,
      userId: 'moderator-id',
      communityId: community.id,
      role: CommunityProfileRole.MODERATOR,
      removedAt: null,
    } as CommunityProfile;
    profileRepository.findOne.mockResolvedValue(profile);

    await service.removeModerator(community.id, profile.communityProfileId);

    expect(profile.role).toBe(CommunityProfileRole.MEMBER);
    expect(notificationsService.notify).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'moderator-id',
        type: NotificationType.COMMUNITY_MODERATOR_REMOVED,
        data: {
          communityId: 5,
          communityName: 'Collectors',
          communitySlug: 'collectors',
        },
        message: 'Ya no eres moderador de esta comunidad.',
      }),
    ]);
  });

  it('keeps the role change when notification delivery fails', async () => {
    const profile = {
      communityProfileId: 10,
      userId: 'member-id',
      communityId: community.id,
      role: CommunityProfileRole.MEMBER,
      removedAt: null,
    } as CommunityProfile;
    profileRepository.findOne.mockResolvedValue(profile);
    notificationsService.notify.mockRejectedValue(new Error('delivery failed'));

    await expect(
      service.addModerator(community.id, profile.communityProfileId),
    ).resolves.toBe(profile);
    expect(profile.role).toBe(CommunityProfileRole.MODERATOR);
  });

  it('does not notify when the administrative operation is rejected', async () => {
    profileRepository.findOne.mockResolvedValue({
      role: CommunityProfileRole.MODERATOR,
      removedAt: null,
    });

    await expect(service.addModerator(community.id, 10)).rejects.toThrow(
      ConflictException,
    );
    expect(notificationsService.notify).not.toHaveBeenCalled();

    profileRepository.findOne.mockResolvedValue({
      role: CommunityProfileRole.MEMBER,
      removedAt: null,
    });
    await expect(service.removeModerator(community.id, 10)).rejects.toThrow(
      ConflictException,
    );
    expect(notificationsService.notify).not.toHaveBeenCalled();
  });

  it('does not notify a removed profile', async () => {
    profileRepository.findOne.mockResolvedValue({
      role: CommunityProfileRole.MEMBER,
      removedAt: new Date(),
    });

    await expect(service.addModerator(community.id, 10)).rejects.toThrow(
      NotFoundException,
    );
    expect(notificationsService.notify).not.toHaveBeenCalled();
  });
});
