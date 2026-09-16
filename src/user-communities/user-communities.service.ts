import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { Community } from '../community/entities/community.entity';
import {
  CommunityProfile,
  CommunityProfileRole,
} from '../community/entities/community-profile.entity';
import { UsersService } from '../users/users.service';
import { CommunityService } from '../community/community.service';
import { GetCommunitiesQueryDto } from '../community/dto/get-communities-query.dto';

interface PostgresError {
  code?: string;
}

@Injectable()
export class UserCommunitiesService {
  constructor(
    @InjectRepository(Community)
    private readonly communityRepository: Repository<Community>,
    @InjectRepository(CommunityProfile)
    private readonly communityProfileRepository: Repository<CommunityProfile>,
    private readonly usersService: UsersService,
    private readonly communityService: CommunityService,
  ) {}

  async joinCommunities(
    userId: string,
    communityIds: number[],
  ): Promise<CommunityProfile[]> {
    const uniqueIds = [...new Set(communityIds)];
    if (uniqueIds.length === 0) {
      return [];
    }

    const communities = await this.communityRepository.findBy({
      id: In(uniqueIds),
    });
    const existingCommunityIds = new Set(communities.map((c) => c.id));
    const missingIds = uniqueIds.filter((id) => !existingCommunityIds.has(id));

    if (missingIds.length > 0) {
      throw new NotFoundException(
        `No existen las siguientes comunidades: ${missingIds.join(', ')}`,
      );
    }

    const existingProfiles = await this.communityProfileRepository.find({
      where: { userId, communityId: In(uniqueIds) },
    });
    const alreadyJoinedIds = new Set(
      existingProfiles.map((p) => p.communityId),
    );
    const toCreateIds = uniqueIds.filter((id) => !alreadyJoinedIds.has(id));

    if (toCreateIds.length === 0) {
      return existingProfiles;
    }

    const user = await this.usersService.findById(userId);
    const newProfiles = toCreateIds.map((communityId) =>
      this.communityProfileRepository.create({
        userId,
        communityId,
        role: CommunityProfileRole.MEMBER,
        displayName: user.username,
        bio: '',
      }),
    );

    try {
      const createdProfiles =
        await this.communityProfileRepository.save(newProfiles);
      return [...existingProfiles, ...createdProfiles];
    } catch (error: unknown) {
      if (error instanceof QueryFailedError) {
        const dbError = error.driverError as PostgresError;
        if (dbError.code === '23505') {
          // Se unió por una petición concurrente; devolvemos el estado actual
          // en lugar de fallar.
          return this.communityProfileRepository.find({
            where: { userId, communityId: In(uniqueIds) },
          });
        }
      }
      throw error;
    }
  }

  async joinCommunity(
    userId: string,
    communityId: number,
  ): Promise<CommunityProfile> {
    const communities = await this.communityRepository.findBy({
      id: In([communityId]),
    });

    if (communities.length === 0) {
      throw new NotFoundException('Comunidad no encontrada');
    }

    const existingProfile = await this.communityProfileRepository.findOne({
      where: { userId, communityId },
    });

    if (existingProfile) {
      throw new ConflictException('Ya perteneces a esta comunidad');
    }

    const user = await this.usersService.findById(userId);
    const profile = this.communityProfileRepository.create({
      userId,
      communityId,
      role: CommunityProfileRole.MEMBER,
      displayName: user.username,
      bio: '',
    });

    try {
      return await this.communityProfileRepository.save(profile);
    } catch (error: unknown) {
      if (error instanceof QueryFailedError) {
        const dbError = error.driverError as PostgresError;
        if (dbError.code === '23505') {
          throw new ConflictException('Ya perteneces a esta comunidad');
        }
      }
      throw error;
    }
  }

  findMyCommunities(userId: string, query: GetCommunitiesQueryDto) {
    return this.communityService.findUserCommunities(userId, query);
  }

  async leaveCommunity(
    userId: string,
    communityId: number,
  ): Promise<{ message: string }> {
    const community = await this.communityRepository.findOne({
      where: { id: communityId },
    });

    if (!community) {
      throw new NotFoundException('Comunidad no encontrada');
    }

    const profile = await this.communityProfileRepository.findOne({
      where: { userId, communityId },
    });

    if (!profile) {
      throw new NotFoundException('No perteneces a esta comunidad');
    }

    if (profile.role === CommunityProfileRole.OWNER) {
      throw new ConflictException(
        'El propietario de la comunidad no puede abandonarla sin transferir la propiedad',
      );
    }

    await this.communityProfileRepository.remove(profile);

    return { message: 'Has abandonado la comunidad correctamente' };
  }
}
