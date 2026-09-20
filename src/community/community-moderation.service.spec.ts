import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
import { Tag } from './entities/tag.entity';

describe('CommunityService moderator management', () => {
  const communityRepository = { findOne: jest.fn() };
  const communityProfileRepository = {
    findOne: jest.fn(),
    save: jest.fn((profile) => Promise.resolve(profile)),
  };
  const service = new CommunityService(
    communityRepository as unknown as Repository<Community>,
    {} as Repository<Category>,
    {} as Repository<Tag>,
    {} as Repository<CommunityRule>,
    {} as never,
    {} as CloudinaryService,
    {} as UsersService,
    communityProfileRepository as unknown as Repository<CommunityProfile>,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    communityRepository.findOne.mockResolvedValue({ id: 5 });
  });

  it('allows an OWNER to promote a MEMBER', async () => {
    const target = {
      communityProfileId: 10,
      communityId: 5,
      role: CommunityProfileRole.MEMBER,
    } as CommunityProfile;
    communityProfileRepository.findOne
      .mockResolvedValueOnce({ role: CommunityProfileRole.OWNER })
      .mockResolvedValueOnce(target);

    await expect(service.addModerator(5, 10, 'owner-id')).resolves.toBe(target);
    expect(target.role).toBe(CommunityProfileRole.MODERATOR);
    expect(communityProfileRepository.save).toHaveBeenCalledWith(target);
  });

  it('rejects non-OWNER actors and invalid moderator targets', async () => {
    communityProfileRepository.findOne.mockResolvedValueOnce({
      role: CommunityProfileRole.MODERATOR,
    });
    await expect(service.addModerator(5, 10, 'moderator-id')).rejects.toThrow(
      ForbiddenException,
    );

    communityProfileRepository.findOne.mockResolvedValueOnce({
      role: CommunityProfileRole.OWNER,
    });
    await expect(service.addModerator(5, 999, 'owner-id')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects promoting an existing MODERATOR or OWNER', async () => {
    communityProfileRepository.findOne
      .mockResolvedValueOnce({ role: CommunityProfileRole.OWNER })
      .mockResolvedValueOnce({ role: CommunityProfileRole.MODERATOR });
    await expect(service.addModerator(5, 10, 'owner-id')).rejects.toThrow(
      'El perfil ya es moderador',
    );

    communityProfileRepository.findOne
      .mockResolvedValueOnce({ role: CommunityProfileRole.OWNER })
      .mockResolvedValueOnce({ role: CommunityProfileRole.OWNER });
    await expect(service.addModerator(5, 10, 'owner-id')).rejects.toThrow(
      ConflictException,
    );
  });

  it('allows an OWNER to demote a MODERATOR without deleting the profile', async () => {
    const target = {
      communityProfileId: 10,
      communityId: 5,
      role: CommunityProfileRole.MODERATOR,
    } as CommunityProfile;
    communityProfileRepository.findOne
      .mockResolvedValueOnce({ role: CommunityProfileRole.OWNER })
      .mockResolvedValueOnce(target);

    await expect(service.removeModerator(5, 10, 'owner-id')).resolves.toBe(
      target,
    );
    expect(target.role).toBe(CommunityProfileRole.MEMBER);
    expect(communityProfileRepository.save).toHaveBeenCalledWith(target);
  });

  it('rejects demoting a MEMBER or OWNER', async () => {
    communityProfileRepository.findOne
      .mockResolvedValueOnce({ role: CommunityProfileRole.OWNER })
      .mockResolvedValueOnce({ role: CommunityProfileRole.MEMBER });
    await expect(service.removeModerator(5, 10, 'owner-id')).rejects.toThrow(
      'No es moderador',
    );

    communityProfileRepository.findOne
      .mockResolvedValueOnce({ role: CommunityProfileRole.OWNER })
      .mockResolvedValueOnce({ role: CommunityProfileRole.OWNER });
    await expect(service.removeModerator(5, 10, 'owner-id')).rejects.toThrow(
      ConflictException,
    );
  });
});
