import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { Community } from '../community/entities/community.entity';
import { CommunityTag } from '../community/entities/community-tag.entity';
import {
  CommunityProfile,
  CommunityProfileRole,
} from '../community/entities/community-profile.entity';
import {
  CommunityJoinRequest,
  CommunityJoinRequestStatus,
} from '../community/entities/community-join-request.entity';
import { Post } from '../community/entities/post.entity';
import { UserTag } from '../user-tags/entities/user-tag.entity';
import { UsersService } from '../users/users.service';
import { CommunityService } from '../community/community.service';
import { GetCommunitiesQueryDto } from '../community/dto/get-communities-query.dto';
import { GetOnboardingRecommendedCommunitiesQueryDto } from './dto/get-onboarding-recommended-communities-query.dto';

interface PostgresError {
  code?: string;
}

export type JoinCommunityResultType =
  'joined' | 'requested' | 'already_member' | 'already_requested';

export interface JoinCommunityResult {
  communityId: number;
  result: JoinCommunityResultType;
}

// Mismo criterio de "reciente" que usa CommunityService para popularidad.
const RECENT_POST_DAYS = 30;

@Injectable()
export class UserCommunitiesService {
  constructor(
    @InjectRepository(Community)
    private readonly communityRepository: Repository<Community>,
    @InjectRepository(CommunityProfile)
    private readonly communityProfileRepository: Repository<CommunityProfile>,
    @InjectRepository(CommunityJoinRequest)
    private readonly communityJoinRequestRepository: Repository<CommunityJoinRequest>,
    @InjectRepository(UserTag)
    private readonly userTagRepository: Repository<UserTag>,
    private readonly usersService: UsersService,
    private readonly communityService: CommunityService,
  ) {}

  /**
   * Usado por POST /users/me/communities (onboarding, bulk) y por
   * POST /communities/:id/join (individual) — misma lógica exacta para que
   * ninguno de los dos puntos de entrada se salte la aprobación de
   * comunidades privadas.
   */
  async joinCommunities(
    userId: string,
    communityIds: number[],
  ): Promise<JoinCommunityResult[]> {
    const uniqueIds = [...new Set(communityIds)];
    if (uniqueIds.length === 0) {
      return [];
    }

    const communities = await this.communityRepository.findBy({
      id: In(uniqueIds),
    });
    const communityById = new Map(communities.map((c) => [c.id, c]));
    const missingIds = uniqueIds.filter((id) => !communityById.has(id));

    if (missingIds.length > 0) {
      throw new NotFoundException(
        `No existen las siguientes comunidades: ${missingIds.join(', ')}`,
      );
    }

    const results: JoinCommunityResult[] = [];
    for (const id of uniqueIds) {
      // Secuencial a propósito: evita condiciones de carrera entre elementos
      // del mismo batch (p. ej. el mismo usuario duplicado por error).
      results.push(
        await this.joinOrRequestCommunity(userId, communityById.get(id)!),
      );
    }

    return results;
  }

  async joinCommunity(
    userId: string,
    communityId: number,
  ): Promise<JoinCommunityResult> {
    const community = await this.communityRepository.findOne({
      where: { id: communityId },
    });

    if (!community) {
      throw new NotFoundException('Comunidad no encontrada');
    }

    return this.joinOrRequestCommunity(userId, community);
  }

  private async joinOrRequestCommunity(
    userId: string,
    community: Community,
  ): Promise<JoinCommunityResult> {
    const communityId = community.id;

    const existingProfile = await this.communityProfileRepository.findOne({
      where: { userId, communityId },
    });

    if (existingProfile) {
      return { communityId, result: 'already_member' };
    }

    if (community.isPrivate) {
      const existingRequest = await this.communityJoinRequestRepository.findOne(
        {
          where: {
            userId,
            communityId,
            status: CommunityJoinRequestStatus.PENDING,
          },
        },
      );

      if (existingRequest) {
        return { communityId, result: 'already_requested' };
      }

      const request = this.communityJoinRequestRepository.create({
        userId,
        communityId,
        status: CommunityJoinRequestStatus.PENDING,
      });

      try {
        await this.communityJoinRequestRepository.save(request);
      } catch (error: unknown) {
        if (this.isUniqueViolation(error)) {
          // Solicitud creada por una petición concurrente.
          return { communityId, result: 'already_requested' };
        }
        throw error;
      }

      return { communityId, result: 'requested' };
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
      await this.communityProfileRepository.save(profile);
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        // Se unió por una petición concurrente.
        return { communityId, result: 'already_member' };
      }
      throw error;
    }

    return { communityId, result: 'joined' };
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const dbError = error.driverError as PostgresError;
    return dbError.code === '23505';
  }

  findMyCommunities(userId: string, query: GetCommunitiesQueryDto) {
    return this.communityService.findUserCommunities(userId, query);
  }

  findRecommendedCommunities(userId: string, query: GetCommunitiesQueryDto) {
    return this.communityService.findRecommendedCommunities(userId, query);
  }

  /**
   * Alimenta el paso de onboarding previo a POST /users/me/communities:
   * coincidencia simple por tags (sin scoring de popularidad ni fallback a
   * categoría, a diferencia de findRecommendedCommunities). El desempate usa
   * el mismo criterio de popularidad (memberCount, recentPostCount) que ya
   * usa sort=popularity en el listado general de comunidades.
   */
  async findOnboardingRecommendedCommunities(
    userId: string,
    query: GetOnboardingRecommendedCommunitiesQueryDto,
  ): Promise<
    Pick<
      Community,
      | 'id'
      | 'name'
      | 'slug'
      | 'description'
      | 'imageUrl'
      | 'bannerUrl'
      | 'isPrivate'
    >[]
  > {
    const userTags = await this.userTagRepository.find({
      where: { userId },
      select: { tagId: true },
    });
    const tagIds = userTags.map((userTag) => userTag.tagId);

    if (tagIds.length === 0) {
      return [];
    }

    const matchedTagCountSubquery = this.communityRepository
      .createQueryBuilder('onboarding_tag_match')
      .subQuery()
      .select('COUNT(DISTINCT onboarding_community_tag.tag_id)')
      .from(CommunityTag, 'onboarding_community_tag')
      .where('onboarding_community_tag.community_id = community.id')
      .andWhere('onboarding_community_tag.tag_id IN (:...tagIds)')
      .getQuery();

    const memberCountSubquery = this.communityRepository
      .createQueryBuilder('onboarding_member_count')
      .subQuery()
      .select('COUNT(*)')
      .from(CommunityProfile, 'onboarding_member_count_profile')
      .where('onboarding_member_count_profile.community_id = community.id')
      .getQuery();

    const recentPostCountSubquery = this.communityRepository
      .createQueryBuilder('onboarding_recent_posts')
      .subQuery()
      .select('COUNT(*)')
      .from(Post, 'onboarding_recent_post')
      .innerJoin(
        CommunityProfile,
        'onboarding_recent_post_profile',
        'onboarding_recent_post_profile.community_profile_id = onboarding_recent_post.community_profile_id',
      )
      .where('onboarding_recent_post_profile.community_id = community.id')
      .andWhere(
        `onboarding_recent_post.posted_at >= NOW() - INTERVAL '${RECENT_POST_DAYS} days'`,
      )
      .getQuery();

    const communities = await this.communityRepository
      .createQueryBuilder('community')
      .addSelect(matchedTagCountSubquery, 'matched_tag_count')
      .addSelect(memberCountSubquery, 'member_count')
      .addSelect(recentPostCountSubquery, 'recent_post_count')
      .where('community.is_active = :isActive', { isActive: true })
      .andWhere(`(${matchedTagCountSubquery}) > 0`)
      .andWhere(
        `NOT EXISTS (
          SELECT 1
          FROM community_profile onboarding_membership
          WHERE onboarding_membership.community_id = community.id
            AND onboarding_membership.user_id = :userId
        )`,
      )
      .setParameters({ tagIds, userId })
      .orderBy('matched_tag_count', 'DESC')
      .addOrderBy('member_count', 'DESC')
      .addOrderBy('recent_post_count', 'DESC')
      .addOrderBy('community.id', 'ASC')
      .take(query.limit)
      .getMany();

    return communities.map((community) => ({
      id: community.id,
      name: community.name,
      slug: community.slug,
      description: community.description,
      imageUrl: community.imageUrl,
      bannerUrl: community.bannerUrl,
      isPrivate: community.isPrivate,
    }));
  }

  /**
   * Si el usuario ya es miembro, abandona la comunidad (comportamiento
   * original). Si en vez de perfil tiene una communityJoinRequest pendiente
   * (comunidad privada, todavía sin aprobar), la cancela en su lugar —
   * la borramos porque el enum de status (pending/accepted/rejected) no
   * tiene un valor "cancelled" y marcarla como "rejected" implicaría
   * incorrectamente que un moderador la rechazó.
   */
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

    if (profile) {
      if (profile.role === CommunityProfileRole.OWNER) {
        throw new ConflictException(
          'El propietario de la comunidad no puede abandonarla sin transferir la propiedad',
        );
      }

      await this.communityProfileRepository.remove(profile);
      return { message: 'Has abandonado la comunidad correctamente' };
    }

    const pendingRequest = await this.communityJoinRequestRepository.findOne({
      where: {
        userId,
        communityId,
        status: CommunityJoinRequestStatus.PENDING,
      },
    });

    if (pendingRequest) {
      await this.communityJoinRequestRepository.remove(pendingRequest);
      return { message: 'Solicitud de unión cancelada correctamente' };
    }

    throw new NotFoundException('No perteneces a esta comunidad');
  }
}
