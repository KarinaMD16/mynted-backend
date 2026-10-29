/* eslint-disable @typescript-eslint/no-unused-vars */
import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { UserCommunitiesService } from './user-communities.service';
import { Community } from '../community/entities/community.entity';
import { CommunityProfile } from '../community/entities/community-profile.entity';
import { CommunityJoinRequest } from '../community/entities/community-join-request.entity';
import { CommunityBan } from '../community/entities/community-ban.entity';
import { UserTag } from '../user-tags/entities/user-tag.entity';
import { UsersService } from '../users/users.service';
import { CommunityService } from '../community/community.service';

describe('UserCommunitiesService community bans', () => {
  it('rejects join before reactivating or creating a profile when the user is banned', async () => {
    const communityProfileRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    const communityBanRepository = {
      findOne: jest.fn().mockResolvedValue({
        communityId: 2,
        userId: 'user-id',
        isActive: true,
      }),
    };
    const service = new UserCommunitiesService(
      {
        findOne: jest.fn().mockResolvedValue({ id: 2, isPrivate: false }),
      } as unknown as Repository<Community>,
      communityProfileRepository as never,
      {} as Repository<CommunityJoinRequest>,
      {} as Repository<UserTag>,
      {} as UsersService,
      {} as CommunityService,
      undefined,
      communityBanRepository as never,
    );

    await expect(service.joinCommunity('user-id', 2)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(communityProfileRepository.create).not.toHaveBeenCalled();
    expect(communityProfileRepository.save).not.toHaveBeenCalled();
  });
});
