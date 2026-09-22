import { ConflictException, NotFoundException } from '@nestjs/common';
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

/**
 * La autorización por rol (solo el OWNER puede llamar a estos endpoints) ya
 * no vive aquí: la resuelve CommunityRoleGuard antes de llegar al controller
 * (ver community-role.guard.spec.ts). Estos tests cubren solo lo que sigue
 * siendo responsabilidad del service una vez que un OWNER ya fue autorizado.
 */
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

  it('allows promoting a MEMBER to MODERATOR', async () => {
    const target = {
      communityProfileId: 10,
      communityId: 5,
      role: CommunityProfileRole.MEMBER,
    } as CommunityProfile;
    communityProfileRepository.findOne.mockResolvedValueOnce(target);

    await expect(service.addModerator(5, 10)).resolves.toBe(target);
    expect(target.role).toBe(CommunityProfileRole.MODERATOR);
    expect(communityProfileRepository.save).toHaveBeenCalledWith(target);
  });

  it('rejects a profile that does not exist in this community', async () => {
    communityProfileRepository.findOne.mockResolvedValueOnce(null);

    await expect(service.addModerator(5, 999)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects promoting an existing MODERATOR or OWNER', async () => {
    communityProfileRepository.findOne.mockResolvedValueOnce({
      role: CommunityProfileRole.MODERATOR,
    });
    await expect(service.addModerator(5, 10)).rejects.toThrow(
      'El perfil ya es moderador',
    );

    communityProfileRepository.findOne.mockResolvedValueOnce({
      role: CommunityProfileRole.OWNER,
    });
    await expect(service.addModerator(5, 10)).rejects.toThrow(
      ConflictException,
    );
  });

  it('allows an OWNER to demote a MODERATOR without deleting the profile', async () => {
    const target = {
      communityProfileId: 10,
      communityId: 5,
      role: CommunityProfileRole.MODERATOR,
    } as CommunityProfile;
    communityProfileRepository.findOne.mockResolvedValueOnce(target);

    await expect(service.removeModerator(5, 10)).resolves.toBe(target);
    expect(target.role).toBe(CommunityProfileRole.MEMBER);
    expect(communityProfileRepository.save).toHaveBeenCalledWith(target);
  });

  it('rejects demoting a MEMBER or OWNER', async () => {
    communityProfileRepository.findOne.mockResolvedValueOnce({
      role: CommunityProfileRole.MEMBER,
    });
    await expect(service.removeModerator(5, 10)).rejects.toThrow(
      'No es moderador',
    );

    communityProfileRepository.findOne.mockResolvedValueOnce({
      role: CommunityProfileRole.OWNER,
    });
    await expect(service.removeModerator(5, 10)).rejects.toThrow(
      ConflictException,
    );
  });
});
