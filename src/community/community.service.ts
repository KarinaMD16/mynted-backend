import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadgeEvents } from '../badges/badge-events';
import { CommunityEvents, JoinRequestResolvedEvent } from './community-events';
import {
  DataSource,
  FindOptionsWhere,
  In,
  IsNull,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { CreateCommunityRuleDto } from './dto/create-community-rule.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateTagDto } from './dto/create-tag.dto';
import { GetTagsQueryDto } from './dto/get-tags-query.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';
import { UpdateCommunityRuleDto } from './dto/update-community-rule.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { GetCommunitiesQueryDto } from './dto/get-communities-query.dto';
import { GetAdminCommunitiesQueryDto } from './dto/get-admin-communities-query.dto';
import { GetCommunityMembersQueryDto } from './dto/get-community-members-query.dto';
import { DeleteCommunityDto } from './dto/delete-community.dto';
import {
  CommunityProfile,
  CommunityProfileRole,
} from './entities/community-profile.entity';
import {
  CommunityJoinRequest,
  CommunityJoinRequestStatus,
} from './entities/community-join-request.entity';
import { Category } from './entities/category.entity';
import { CommunityRule } from './entities/community-rule.entity';
import { CommunityTag } from './entities/community-tag.entity';
import { Community } from './entities/community.entity';
import { Tag } from './entities/tag.entity';
import { Post } from './entities/post.entity';
import { Reply } from './entities/reply.entity';
import { PostVote } from './entities/post-vote.entity';
import { Favorite, FavoriteItemType } from './entities/favorite.entity';
import { VoteType } from './entities/vote-type.enum';
import { UserTag } from '../user-tags/entities/user-tag.entity';
import { UsersService } from '../users/users.service';
import { User, UserRole } from '../users/entities/user.entity';
import { escapeLike } from '../common/escape-like';
import { Product } from '../products/entities/product.entity';
import { Report } from '../reports/entities/report.entity';
import { ReportStatus } from '../reports/enums/report-status.enum';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { ModerationActionsService } from '../moderation-actions/moderation-actions.service';
import {
  MODERATION_ACTIONS,
  MODERATION_TARGET_TYPES,
  ModerationActionType,
} from '../moderation-actions/constants/moderation-action.constants';

interface PostgresError {
  code?: string;
  constraint?: string;
}

type CommunityRuleSummary = Pick<
  CommunityRule,
  'communityRuleId' | 'description'
>;

type RecommendationStage = 'interests' | 'categories' | 'popularity';

const RECENT_POST_DAYS = 30;

@Injectable()
export class CommunityService {
  constructor(
    @InjectRepository(Community)
    private readonly communityRepository: Repository<Community>,
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(Tag)
    private readonly tagRepository: Repository<Tag>,
    @InjectRepository(CommunityRule)
    private readonly communityRuleRepository: Repository<CommunityRule>,
    private readonly dataSource: DataSource,
    private readonly cloudinaryService: CloudinaryService,
    private readonly usersService: UsersService,
    @InjectRepository(CommunityProfile)
    private readonly communityProfileRepository: Repository<CommunityProfile>,
    @InjectRepository(CommunityJoinRequest)
    private readonly communityJoinRequestRepository: Repository<CommunityJoinRequest>,
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
    @Optional()
    @InjectRepository(Reply)
    private readonly replyRepository?: Repository<Reply>,
    @Optional()
    @InjectRepository(PostVote)
    private readonly postVoteRepository?: Repository<PostVote>,
    @Optional()
    @InjectRepository(Favorite)
    private readonly favoriteRepository?: Repository<Favorite>,
    @Optional()
    private readonly eventEmitter?: EventEmitter2,
    @Optional()
    @InjectRepository(Product)
    private readonly productRepository?: Repository<Product>,
    @Optional()
    @InjectRepository(Report)
    private readonly reportRepository?: Repository<Report>,
    @Optional()
    private readonly notificationsService?: NotificationsService,
    @Optional()
    private readonly moderationActionsService?: ModerationActionsService,
  ) {}

  async create(
    dto: CreateCommunityDto,
    image: Express.Multer.File | undefined,
    banner: Express.Multer.File | undefined,
    userId: string,
  ): Promise<Community> {
    this.validateCollections(dto);

    const [communityWithName, communityWithSlug, category, tags] =
      await Promise.all([
        this.communityRepository.findOne({ where: { name: dto.name } }),
        this.communityRepository.findOne({ where: { slug: dto.slug } }),
        this.categoryRepository.findOne({
          where: { categoryId: dto.categoryId, isActive: true },
        }),
        this.tagRepository.find({ where: { tagId: In(dto.tagIds) } }),
      ]);

    if (communityWithName) {
      throw new ConflictException('Ya existe una comunidad con ese nombre');
    }

    if (communityWithSlug) {
      throw new ConflictException('Ya existe una comunidad con ese slug');
    }

    if (!category) {
      throw new NotFoundException('La categoría seleccionada no existe');
    }

    const existingTagIds = new Set(tags.map((tag) => tag.tagId));
    const missingTagIds = dto.tagIds.filter(
      (tagId) => !existingTagIds.has(tagId),
    );

    if (missingTagIds.length > 0) {
      throw new NotFoundException(
        `No existen los siguientes tags: ${missingTagIds.join(', ')}`,
      );
    }

    const user = await this.usersService.findById(userId);
    const isSuperAdmin = user.role === UserRole.SUPERADMIN;

    if (dto.ownerId && !isSuperAdmin) {
      throw new ForbiddenException(
        'Solo un superadministrador puede asignar otro owner',
      );
    }

    let ownerUser = user;
    if (isSuperAdmin && dto.ownerId) {
      ownerUser = await this.usersService.findById(dto.ownerId);
      if (!ownerUser.isActive) {
        throw new BadRequestException(
          'El usuario seleccionado como owner está inactivo',
        );
      }
    }

    const shouldCreateOwnerProfile = !isSuperAdmin || Boolean(dto.ownerId);
    let imageUrl: string | null = null;
    let bannerUrl: string | null = null;
    const filesToUpload: Express.Multer.File[] = [];

    if (image) filesToUpload.push(image);
    if (banner) filesToUpload.push(banner);

    if (filesToUpload.length > 0) {
      const uploads = await this.uploadImages(filesToUpload);
      let uploadIndex = 0;

      if (image) {
        imageUrl = uploads[uploadIndex].url;
        uploadIndex += 1;
      }

      if (banner) {
        bannerUrl = uploads[uploadIndex].url;
      }
    }

    let creatorProfileId: number | undefined;

    try {
      const created = await this.dataSource.transaction(async (manager) => {
        const community = manager.create(Community, {
          name: dto.name,
          description: dto.description,
          slug: dto.slug,
          isActive: true,
          isPrivate: dto.isPrivate,
          imageUrl,
          bannerUrl,
          categoryId: dto.categoryId,
        });

        const savedCommunity = await manager.save(Community, community);

        if (shouldCreateOwnerProfile) {
          const ownerProfile = manager.create(CommunityProfile, {
            displayName: ownerUser.username,
            bio: '',
            role: CommunityProfileRole.OWNER,
            userId: ownerUser.id,
            communityId: savedCommunity.id,
          });
          const savedOwner = await manager.save(CommunityProfile, ownerProfile);
          creatorProfileId = savedOwner.communityProfileId;
        }

        const communityTags = dto.tagIds.map((tagId) =>
          manager.create(CommunityTag, {
            communityId: savedCommunity.id,
            tagId,
          }),
        );
        await manager.save(CommunityTag, communityTags);

        const communityRules = dto.rules.map((description) =>
          manager.create(CommunityRule, {
            communityId: savedCommunity.id,
            description,
          }),
        );

        if (communityRules.length > 0) {
          await manager.save(CommunityRule, communityRules);
        }

        const result = await manager.findOne(Community, {
          where: { id: savedCommunity.id },
          relations: {
            category: true,
            communityTags: { tag: true },
            rules: true,
          },
        });

        if (!result) {
          throw new InternalServerErrorException(
            'No fue posible recuperar la comunidad creada',
          );
        }

        return result;
      });

      if (creatorProfileId !== undefined) {
        this.eventEmitter?.emit(BadgeEvents.MEMBER_JOINED, {
          userId: ownerUser.id,
          communityProfileId: creatorProfileId,
          communityId: created.id,
        });
      }

      return created;
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async findAllCommunities(query: GetCommunitiesQueryDto) {
    const queryBuilder = this.buildCommunityListQuery(query);
    const total = await queryBuilder.clone().getCount();
    const { entities, raw } = await queryBuilder
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getRawAndEntities();

    return {
      data: this.mapCommunityList(entities, raw),
      pagination: this.buildPagination(query.page, query.limit, total),
    };
  }

  async findAllCommunitiesForAdmin(query: GetAdminCommunitiesQueryDto) {
    const queryBuilder = this.buildAdminCommunityListQuery(query);
    const total = await queryBuilder.clone().getCount();
    const { entities, raw } = await queryBuilder
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getRawAndEntities();

    return {
      data: this.mapAdminCommunityList(entities, raw),
      pagination: this.buildPagination(query.page, query.limit, total),
    };
  }

  async findUserCommunities(userId: string, query: GetCommunitiesQueryDto) {
    const queryBuilder = this.buildCommunityListQuery(query, userId);
    const total = await queryBuilder.clone().getCount();
    const { entities, raw } = await queryBuilder
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getRawAndEntities();

    return {
      data: this.mapCommunityList(entities, raw, true),
      pagination: this.buildPagination(query.page, query.limit, total),
    };
  }

  async findRecommendedCommunities(
    userId: string,
    query: GetCommunitiesQueryDto,
  ) {
    const stages: RecommendationStage[] = [
      'interests',
      'categories',
      'popularity',
    ];
    const stageQueries = stages.map((stage) =>
      this.buildRecommendationQuery(userId, stage),
    );
    const stageCounts = await Promise.all(
      stageQueries.map((stageQuery) => stageQuery.clone().getCount()),
    );
    const total = stageCounts.reduce((sum, count) => sum + count, 0);
    const offset = (query.page - 1) * query.limit;
    let remainingOffset = offset;
    let remainingLimit = query.limit;
    const data: ReturnType<typeof this.mapRecommendedCommunities> = [];

    for (let index = 0; index < stageQueries.length; index += 1) {
      const stageCount = stageCounts[index];

      if (remainingOffset >= stageCount) {
        remainingOffset -= stageCount;
        continue;
      }

      if (remainingLimit === 0) break;

      const { entities, raw } = await stageQueries[index]
        .skip(remainingOffset)
        .take(remainingLimit)
        .getRawAndEntities();
      data.push(...this.mapRecommendedCommunities(entities, raw));
      remainingLimit -= entities.length;
      remainingOffset = 0;
    }

    return {
      data,
      pagination: this.buildPagination(query.page, query.limit, total),
    };
  }

  private buildRecommendationQuery(userId: string, stage: RecommendationStage) {
    const memberCountSubquery = this.communityRepository
      .createQueryBuilder('recommended_member_count')
      .subQuery()
      .select('COUNT(*)')
      .from(CommunityProfile, 'recommended_member_count_profile')
      .where('recommended_member_count_profile.community_id = community.id')
      .andWhere('recommended_member_count_profile.removed_at IS NULL')
      .getQuery();

    const recentPostCountSubquery = this.communityRepository
      .createQueryBuilder('recommended_recent_posts')
      .subQuery()
      .select('COUNT(*)')
      .from(Post, 'recommended_recent_post')
      .innerJoin(
        CommunityProfile,
        'recommended_recent_post_profile',
        'recommended_recent_post_profile.community_profile_id = recommended_recent_post.community_profile_id',
      )
      .where('recommended_recent_post_profile.community_id = community.id')
      .andWhere(
        `recommended_recent_post.posted_at >= NOW() - INTERVAL '${RECENT_POST_DAYS} days'`,
      )
      .getQuery();

    const matchedInterestSubquery = this.communityRepository
      .createQueryBuilder('recommended_interest_matches')
      .subQuery()
      .select('COUNT(DISTINCT recommended_community_tag.tag_id)')
      .from(CommunityTag, 'recommended_community_tag')
      .innerJoin(
        UserTag,
        'recommended_user_tag',
        'recommended_user_tag.tag_id = recommended_community_tag.tag_id',
      )
      .where('recommended_community_tag.community_id = community.id')
      .andWhere('recommended_user_tag.user_id = :userId', { userId })
      .getQuery();

    const categoryMatchSubquery = this.communityRepository
      .createQueryBuilder('recommended_category_match')
      .subQuery()
      .select('1')
      .from(CommunityProfile, 'recommended_category_profile')
      .innerJoin(
        Community,
        'recommended_category_community',
        'recommended_category_community.id = recommended_category_profile.community_id',
      )
      .where('recommended_category_profile.user_id = :userId', { userId })
      .andWhere('recommended_category_profile.removed_at IS NULL')
      .andWhere(
        'recommended_category_community.category_id = community.category_id',
      )
      .andWhere('recommended_category_community.is_active = true')
      .limit(1)
      .getQuery();

    const popularityExpression = `0.7 * LN(1 + (${memberCountSubquery})::numeric) + 0.3 * LN(1 + (${recentPostCountSubquery})::numeric)`;

    const queryBuilder = this.communityRepository
      .createQueryBuilder('community')
      .leftJoinAndSelect('community.category', 'category')
      .addSelect(memberCountSubquery, 'member_count')
      .addSelect(recentPostCountSubquery, 'recent_post_count')
      .addSelect(
        `COALESCE(${matchedInterestSubquery}, 0)`,
        'matched_interest_count',
      )
      .addSelect(
        `CASE WHEN EXISTS (${categoryMatchSubquery}) THEN 1 ELSE 0 END`,
        'category_match',
      )
      .addSelect(popularityExpression, 'recommendation_popularity_score')
      .where('community.is_active = :isActive', { isActive: true })
      .andWhere(
        `NOT EXISTS (
          SELECT 1
          FROM community_profile recommendation_membership
          WHERE recommendation_membership.community_id = community.id
            AND recommendation_membership.user_id = :userId
        )`,
        { userId },
      );

    if (stage === 'interests') {
      queryBuilder
        .andWhere(`${matchedInterestSubquery} > 0`)
        .orderBy('matched_interest_count', 'DESC');
    } else if (stage === 'categories') {
      queryBuilder
        .andWhere(`${matchedInterestSubquery} = 0`)
        .andWhere(`EXISTS (${categoryMatchSubquery})`)
        .orderBy('recommendation_popularity_score', 'DESC');
    } else {
      queryBuilder
        .andWhere(`${matchedInterestSubquery} = 0`)
        .andWhere(`NOT EXISTS (${categoryMatchSubquery})`)
        .orderBy('recommendation_popularity_score', 'DESC');
    }

    return queryBuilder
      .addOrderBy('community.created_at', 'DESC')
      .addOrderBy('community.id', 'ASC');
  }

  private mapRecommendedCommunities(communities: Community[], raw: unknown[]) {
    const rawRows = raw as Record<string, unknown>[];

    return communities.map((community, index) => {
      const row = rawRows[index] ?? {};
      const memberCount = this.toNumber(row.member_count);
      const recentPostCount = this.toNumber(row.recent_post_count);

      return {
        id: community.id,
        name: community.name,
        description: community.description,
        slug: community.slug,
        isPrivate: community.isPrivate,
        imageUrl: community.imageUrl,
        bannerUrl: community.bannerUrl,
        createdAt: community.createdAt,
        category: community.category,
        memberCount,
        recentPostCount,
        popularityScore: this.calculatePopularityScore(
          memberCount,
          recentPostCount,
        ),
        matchedInterestCount: this.toNumber(row.matched_interest_count),
      };
    });
  }

  async findCommunityDetail(communityId: number, userId: string) {
    const community = await this.communityRepository.findOne({
      where: { id: communityId, isActive: true },
      relations: {
        category: true,
        communityTags: { tag: true },
        rules: true,
      },
    });

    if (!community) {
      throw new NotFoundException('Comunidad no encontrada');
    }

    const [memberCount, recentPostCount, membership] = await Promise.all([
      this.communityProfileRepository.count({
        where: { communityId, removedAt: IsNull() },
      }),
      this.countRecentPosts(communityId),
      this.communityProfileRepository.findOne({
        where: { userId, communityId, removedAt: IsNull() },
        select: { communityProfileId: true, role: true },
      }),
    ]);
    const forumPosts =
      community.isPrivate && !membership
        ? []
        : await this.findRecentForumPosts(communityId, userId);

    const forumPostMetrics = await this.getForumPostMetrics(
      forumPosts,
      membership?.communityProfileId,
      userId,
    );

    return {
      id: community.id,
      name: community.name,
      description: community.description,
      slug: community.slug,
      isPrivate: community.isPrivate,
      imageUrl: community.imageUrl,
      bannerUrl: community.bannerUrl,
      createdAt: community.createdAt,
      category: community.category,
      tags: community.communityTags.map(({ tag }) => ({
        tagId: tag.tagId,
        name: tag.name,
      })),
      rules: community.rules
        .sort((left, right) => left.communityRuleId - right.communityRuleId)
        .map(({ communityRuleId, description }) => ({
          communityRuleId,
          description,
        })),
      memberCount,
      recentPostCount,
      popularityScore: this.calculatePopularityScore(
        memberCount,
        recentPostCount,
      ),
      isMember: membership !== null,
      membershipRole: membership?.role ?? null,
      forumPosts: forumPosts.map((post) => ({
        id: post.id,
        title: post.title,
        body: post.body,
        postedAt: post.postedAt,
        ...(forumPostMetrics.get(post.id) ?? this.emptyForumPostMetric()),
        author: post.communityProfile
          ? {
              communityProfileId: post.communityProfile.communityProfileId,
              displayName: post.communityProfile.displayName,
              role: post.communityProfile.role,
            }
          : null,
        isHidden: post.isHidden,
        hiddenAt: post.hiddenAt,
        hiddenReason: post.hiddenReason,
      })),
    };
  }

  async findCommunityDetailBySlug(slug: string, userId: string | undefined) {
    const community = await this.communityRepository.findOne({
      where: { slug, isActive: true },
      relations: {
        category: true,
        communityTags: { tag: true },
        rules: true,
      },
    });

    if (!community) {
      throw new NotFoundException('Comunidad no encontrada');
    }

    const [memberCount, recentPostCount, membership, latestJoinRequest] =
      await Promise.all([
        this.communityProfileRepository.count({
          where: { communityId: community.id, removedAt: IsNull() },
        }),
        this.countRecentPosts(community.id),
        userId
          ? this.communityProfileRepository.findOne({
              where: { userId, communityId: community.id, removedAt: IsNull() },
              select: { communityProfileId: true, role: true },
            })
          : Promise.resolve(null),
        userId
          ? this.communityJoinRequestRepository.findOne({
              where: { userId, communityId: community.id },
              order: { createdAt: 'DESC' },
            })
          : Promise.resolve(null),
      ]);
    const forumPosts =
      community.isPrivate && !membership
        ? []
        : await this.findRecentForumPosts(community.id, userId);

    const forumPostMetrics = await this.getForumPostMetrics(
      forumPosts,
      membership?.communityProfileId,
      userId,
    );

    return {
      id: community.id,
      name: community.name,
      description: community.description,
      slug: community.slug,
      isPrivate: community.isPrivate,
      imageUrl: community.imageUrl,
      bannerUrl: community.bannerUrl,
      createdAt: community.createdAt,
      category: community.category,
      tags: community.communityTags.map(({ tag }) => ({
        tagId: tag.tagId,
        name: tag.name,
      })),
      rules: community.rules
        .sort((left, right) => left.communityRuleId - right.communityRuleId)
        .map(({ communityRuleId, description }) => ({
          communityRuleId,
          description,
        })),
      memberCount,
      recentPostCount,
      popularityScore: this.calculatePopularityScore(
        memberCount,
        recentPostCount,
      ),
      isMember: membership !== null,
      membershipRole: membership?.role ?? null,
      joinRequestStatus: latestJoinRequest?.status ?? null,
      forumPosts: forumPosts.map((post) => ({
        id: post.id,
        title: post.title,
        body: post.body,
        postedAt: post.postedAt,
        ...(forumPostMetrics.get(post.id) ?? this.emptyForumPostMetric()),
        author: post.communityProfile
          ? {
              communityProfileId: post.communityProfile.communityProfileId,
              displayName: post.communityProfile.displayName,
              role: post.communityProfile.role,
            }
          : null,
        isHidden: post.isHidden,
        hiddenAt: post.hiddenAt,
        hiddenReason: post.hiddenReason,
      })),
    };
  }

  async getStats(communityId: number) {
    await this.ensureActiveCommunityExists(communityId);

    const [memberCount, postCount, recentPostCount] = await Promise.all([
      this.communityProfileRepository.count({
        where: { communityId, removedAt: IsNull() },
      }),
      this.countAllPosts(communityId),
      this.countRecentPosts(communityId),
    ]);

    return {
      communityId,
      memberCount,
      postCount,
      recentPostCount,
    };
  }

  async findCommunityMembers(
    communityId: number,
    query: GetCommunityMembersQueryDto,
  ) {
    await this.ensureCommunityExists(communityId);

    const search = query.search?.trim();
    const membersQuery = this.communityProfileRepository
      .createQueryBuilder('profile')
      .innerJoinAndSelect('profile.user', 'user', 'user.deleted_at IS NULL')
      .where('profile.community_id = :communityId', { communityId })
      .andWhere('profile.removed_at IS NULL')
      .orderBy('profile.joined_at', 'DESC')
      .addOrderBy('profile.community_profile_id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    if (query.role) {
      membersQuery.andWhere('profile.role = :role', { role: query.role });
    }
    if (search) {
      membersQuery.andWhere(
        '(user.username ILIKE :search OR profile.display_name ILIKE :search)',
        { search: `%${escapeLike(search)}%` },
      );
    }

    const [profiles, total] = await membersQuery.getManyAndCount();
    const profileIds = profiles.map((profile) => profile.communityProfileId);
    const [postCounts, replyCounts] = await Promise.all([
      this.getCommunityMemberPostCounts(profileIds),
      this.getCommunityMemberReplyCounts(profileIds),
    ]);

    return {
      data: profiles.map((profile) => {
        const postCount = postCounts.get(profile.communityProfileId);
        const replyCount = replyCounts.get(profile.communityProfileId);
        return {
          communityProfileId: profile.communityProfileId,
          userId: profile.userId,
          username: profile.user.username,
          displayName: profile.displayName,
          photoUrl: profile.user.photoUrl ?? null,
          role: profile.role,
          joinedAt: profile.joinedAt,
          postCount: postCount?.total ?? 0,
          replyCount: replyCount?.total ?? 0,
          hiddenContentCount:
            (postCount?.hidden ?? 0) + (replyCount?.hidden ?? 0),
        };
      }),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  private async getCommunityMemberPostCounts(
    profileIds: number[],
  ): Promise<Map<number, { total: number; hidden: number }>> {
    const result = new Map<number, { total: number; hidden: number }>();
    if (profileIds.length === 0) return result;

    const rows = await this.postRepository
      .createQueryBuilder('member_post')
      .select('member_post.community_profile_id', 'profileId')
      .addSelect('COUNT(member_post.id)', 'total')
      .addSelect(
        'COUNT(*) FILTER (WHERE member_post.is_hidden = true)',
        'hidden',
      )
      .where('member_post.community_profile_id IN (:...profileIds)', {
        profileIds,
      })
      .groupBy('member_post.community_profile_id')
      .getRawMany<{
        profileId: number | string;
        total: string;
        hidden: string;
      }>();

    for (const row of rows) {
      result.set(Number(row.profileId), {
        total: Number(row.total),
        hidden: Number(row.hidden),
      });
    }
    return result;
  }

  private async getCommunityMemberReplyCounts(
    profileIds: number[],
  ): Promise<Map<number, { total: number; hidden: number }>> {
    const result = new Map<number, { total: number; hidden: number }>();
    if (profileIds.length === 0) return result;

    const replyRepository =
      this.replyRepository ?? this.dataSource.getRepository(Reply);
    const rows = await replyRepository
      .createQueryBuilder('member_reply')
      .select('member_reply.community_profile_id', 'profileId')
      .addSelect('COUNT(member_reply.id)', 'total')
      .addSelect(
        'COUNT(*) FILTER (WHERE member_reply.is_hidden = true)',
        'hidden',
      )
      .where('member_reply.community_profile_id IN (:...profileIds)', {
        profileIds,
      })
      .groupBy('member_reply.community_profile_id')
      .getRawMany<{
        profileId: number | string;
        total: string;
        hidden: string;
      }>();

    for (const row of rows) {
      result.set(Number(row.profileId), {
        total: Number(row.total),
        hidden: Number(row.hidden),
      });
    }
    return result;
  }

  async addModerator(
    communityId: number,
    profileId: number,
  ): Promise<CommunityProfile> {
    await this.ensureCommunityExists(communityId);

    const profile = await this.communityProfileRepository.findOne({
      where: { communityProfileId: profileId, communityId },
    });

    if (!profile) {
      throw new NotFoundException('El perfil no existe en esta comunidad');
    }

    if (profile.removedAt !== null && profile.removedAt !== undefined) {
      throw new NotFoundException('El perfil no existe en esta comunidad');
    }

    if (profile.role === CommunityProfileRole.OWNER) {
      throw new ConflictException(
        'No se puede modificar el rol del propietario desde este endpoint',
      );
    }

    if (profile.role === CommunityProfileRole.MODERATOR) {
      throw new ConflictException(
        'El perfil ya es moderador de esta comunidad',
      );
    }

    profile.role = CommunityProfileRole.MODERATOR;
    // moderator es un badge derivado del rol: no se guarda, no hay evento.
    return this.communityProfileRepository.save(profile);
  }

  async removeCommunityMember(
    communityId: number,
    profileId: number,
    actorUserId: string,
    reason: string,
  ): Promise<{ message: string }> {
    if (!this.moderationActionsService || !this.notificationsService) {
      throw new InternalServerErrorException(
        'La moderación de miembros no está configurada',
      );
    }

    let targetUserId = '';
    let communityName = '';
    let communitySlug = '';
    let changed = false;

    await this.dataSource.transaction(async (manager) => {
      const communityRepository = manager.getRepository(Community);
      const profileRepository = manager.getRepository(CommunityProfile);
      const userRepository = manager.getRepository(User);
      const requestRepository = manager.getRepository(CommunityJoinRequest);

      const community = await communityRepository.findOne({
        where: { id: communityId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!community) {
        throw new NotFoundException('Comunidad no encontrada');
      }

      const actor = await userRepository.findOne({
        where: { id: actorUserId },
      });
      if (!actor) {
        throw new ForbiddenException('Usuario no encontrado');
      }

      const target = await profileRepository.findOne({
        where: { communityProfileId: profileId, communityId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !target ||
        (target.removedAt !== null && target.removedAt !== undefined)
      ) {
        throw new NotFoundException('El perfil no existe en esta comunidad');
      }

      const targetUser = await userRepository.findOne({
        where: { id: target.userId },
        withDeleted: true,
      });
      if (!targetUser || targetUser.deletedAt) {
        throw new NotFoundException('El usuario no existe');
      }
      if (target.userId === actorUserId) {
        throw new ConflictException(
          'No puedes expulsarte a ti mismo; utiliza el endpoint para salir',
        );
      }
      if (target.role === CommunityProfileRole.OWNER) {
        throw new ConflictException(
          'El propietario no puede ser expulsado desde este endpoint',
        );
      }

      let actorProfile: CommunityProfile | null = null;
      if (actor.role !== UserRole.SUPERADMIN) {
        actorProfile = await profileRepository.findOne({
          where: { userId: actorUserId, communityId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!actorProfile || actorProfile.removedAt) {
          throw new ForbiddenException(
            'No tienes permisos para administrar esta comunidad',
          );
        }
        if (
          actorProfile.role === CommunityProfileRole.MODERATOR &&
          target.role !== CommunityProfileRole.MEMBER
        ) {
          throw new ForbiddenException(
            'Los moderadores solo pueden expulsar miembros',
          );
        }
        if (
          actorProfile.role !== CommunityProfileRole.OWNER &&
          actorProfile.role !== CommunityProfileRole.MODERATOR
        ) {
          throw new ForbiddenException(
            'No tienes permisos para administrar esta comunidad',
          );
        }
      }

      target.removedAt = new Date();
      target.role = CommunityProfileRole.MEMBER;
      await profileRepository.save(target);
      await requestRepository.delete({
        userId: target.userId,
        communityId,
        status: CommunityJoinRequestStatus.PENDING,
      });
      await this.moderationActionsService!.record(
        {
          actorUserId,
          targetType: MODERATION_TARGET_TYPES.COMMUNITY_PROFILE,
          targetId: profileId,
          action: MODERATION_ACTIONS.COMMUNITY_MEMBER_REMOVED,
          reason,
          communityId,
        },
        manager,
      );

      targetUserId = target.userId;
      communityName = community.name;
      communitySlug = community.slug;
      changed = true;
    });

    if (changed) {
      try {
        await this.notificationsService.notify([
          {
            userId: targetUserId,
            type: NotificationType.COMMUNITY_MEMBER_REMOVED,
            data: { communityId, communityName, communitySlug, reason },
            message: `Has sido expulsado de ${communityName}`,
          },
        ]);
      } catch {
        // La expulsión y la auditoría ya están confirmadas; una falla de
        // notificación no debe revertir la operación.
      }
    }

    return { message: 'Miembro expulsado correctamente' };
  }

  async removeModerator(
    communityId: number,
    profileId: number,
  ): Promise<CommunityProfile> {
    await this.ensureCommunityExists(communityId);

    const profile = await this.communityProfileRepository.findOne({
      where: { communityProfileId: profileId, communityId },
    });

    if (!profile) {
      throw new NotFoundException('El perfil no existe en esta comunidad');
    }

    if (profile.removedAt !== null && profile.removedAt !== undefined) {
      throw new NotFoundException('El perfil no existe en esta comunidad');
    }

    if (profile.role === CommunityProfileRole.OWNER) {
      throw new ConflictException(
        'No se puede modificar el rol del propietario desde este endpoint',
      );
    }

    if (profile.role === CommunityProfileRole.MEMBER) {
      throw new ConflictException('No es moderador de esta comunidad');
    }

    profile.role = CommunityProfileRole.MEMBER;
    return this.communityProfileRepository.save(profile);
  }

  async findJoinRequests(communityId: number): Promise<CommunityJoinRequest[]> {
    await this.ensureCommunityExists(communityId);

    return this.communityJoinRequestRepository.find({
      where: { communityId, status: CommunityJoinRequestStatus.PENDING },
      relations: { user: true },
      select: {
        user: { id: true, username: true, photoUrl: true },
      },
      order: { createdAt: 'ASC' },
    });
  }

  async acceptJoinRequest(
    communityId: number,
    requestId: number,
    actingUserId: string,
  ): Promise<CommunityProfile> {
    const { request, actingProfile } = await this.resolveJoinRequest(
      communityId,
      requestId,
      actingUserId,
    );

    const accepted = await this.dataSource.transaction(async (manager) => {
      const user = await this.usersService.findById(request.userId);
      const profile = await manager.findOne(CommunityProfile, {
        where: { userId: request.userId, communityId },
        lock: { mode: 'pessimistic_write' },
      });
      const activeProfile =
        profile ??
        manager.create(CommunityProfile, {
          userId: request.userId,
          communityId,
          role: CommunityProfileRole.MEMBER,
          displayName: user.username,
          bio: '',
        });
      activeProfile.removedAt = null;
      activeProfile.joinedAt = new Date();
      activeProfile.role = CommunityProfileRole.MEMBER;
      activeProfile.displayName = activeProfile.displayName || user.username;
      activeProfile.bio = activeProfile.bio ?? '';
      const savedProfile = await manager.save(CommunityProfile, activeProfile);

      request.status = CommunityJoinRequestStatus.ACCEPTED;
      request.resolvedAt = new Date();
      request.resolvedByProfileId = actingProfile.communityProfileId;
      await manager.save(CommunityJoinRequest, request);

      return savedProfile;
    });

    this.eventEmitter?.emit(BadgeEvents.MEMBER_JOINED, {
      userId: request.userId,
      communityProfileId: accepted.communityProfileId,
      communityId,
    });
    this.emitJoinRequestResolved(request, true, actingUserId);

    return accepted;
  }

  async rejectJoinRequest(
    communityId: number,
    requestId: number,
    actingUserId: string,
  ): Promise<CommunityJoinRequest> {
    const { request, actingProfile } = await this.resolveJoinRequest(
      communityId,
      requestId,
      actingUserId,
    );

    request.status = CommunityJoinRequestStatus.REJECTED;
    request.resolvedAt = new Date();
    request.resolvedByProfileId = actingProfile.communityProfileId;
    const saved = await this.communityJoinRequestRepository.save(request);
    this.emitJoinRequestResolved(request, false, actingUserId);
    return saved;
  }

  private emitJoinRequestResolved(
    request: CommunityJoinRequest,
    accepted: boolean,
    resolvedByUserId: string,
  ): void {
    const event: JoinRequestResolvedEvent = {
      requestId: request.id,
      communityId: request.communityId,
      userId: request.userId,
      accepted,
      resolvedByUserId,
    };
    this.eventEmitter?.emit(CommunityEvents.JOIN_REQUEST_RESOLVED, event);
  }

  private async resolveJoinRequest(
    communityId: number,
    requestId: number,
    actingUserId: string,
  ): Promise<{
    request: CommunityJoinRequest;
    actingProfile: CommunityProfile;
  }> {
    await this.ensureCommunityExists(communityId);

    const request = await this.communityJoinRequestRepository.findOne({
      where: { id: requestId, communityId },
    });

    if (!request) {
      throw new NotFoundException('La solicitud no existe en esta comunidad');
    }

    if (request.status !== CommunityJoinRequestStatus.PENDING) {
      throw new ConflictException('La solicitud ya fue resuelta');
    }

    // El guard ya exige owner/moderador para llegar hasta acá; se vuelve a
    // resolver el perfil del que actúa porque necesitamos su id para
    // resolvedByProfileId, no solo su rol.
    const actingProfile = await this.communityProfileRepository.findOne({
      where: { userId: actingUserId, communityId },
    });

    if (!actingProfile) {
      throw new ForbiddenException(
        'No tienes permisos para administrar esta comunidad',
      );
    }

    return { request, actingProfile };
  }

  private countRecentPosts(communityId: number): Promise<number> {
    return this.postRepository
      .createQueryBuilder('post')
      .innerJoin(
        CommunityProfile,
        'recent_post_profile',
        'recent_post_profile.community_profile_id = post.community_profile_id',
      )
      .where(
        `recent_post_profile.community_id = :communityId
         AND post.is_hidden = false
         AND post.posted_at >= NOW() - INTERVAL '${RECENT_POST_DAYS} days'`,
        { communityId },
      )
      .getCount();
  }

  private countAllPosts(communityId: number): Promise<number> {
    return this.postRepository
      .createQueryBuilder('post')
      .innerJoin(
        CommunityProfile,
        'post_profile',
        'post_profile.community_profile_id = post.community_profile_id',
      )
      .where(
        'post_profile.community_id = :communityId AND post.is_hidden = false',
        { communityId },
      )
      .getCount();
  }

  private findRecentForumPosts(
    communityId: number,
    userId?: string,
  ): Promise<Post[]> {
    const query = this.postRepository
      .createQueryBuilder('post')
      .innerJoinAndSelect('post.communityProfile', 'communityProfile');
    if (!userId) {
      query.where(
        'communityProfile.community_id = :communityId AND post.is_hidden = false',
        { communityId },
      );
    } else {
      query.where(
        `communityProfile.community_id = :communityId
         AND (post.is_hidden = false OR communityProfile.user_id = :userId OR EXISTS (
          SELECT 1 FROM community_profile viewer_profile
          WHERE viewer_profile.user_id = :userId
            AND viewer_profile.community_id = :communityId
            AND viewer_profile.removed_at IS NULL
            AND viewer_profile.role IN ('moderator', 'owner')
        ))`,
        { userId, communityId },
      );
    }
    query.orderBy('post.posted_at', 'DESC').take(10);
    return query.getMany();
  }

  private buildCommunityListQuery(
    query: GetCommunitiesQueryDto,
    userId?: string,
  ) {
    const memberCountSubquery = this.communityRepository
      .createQueryBuilder('member_count_profile')
      .subQuery()
      .select('COUNT(*)')
      .from(CommunityProfile, 'member_count_profile')
      .where('member_count_profile.community_id = community.id')
      .andWhere('member_count_profile.removed_at IS NULL')
      .getQuery();

    const recentPostCountSubquery = this.communityRepository
      .createQueryBuilder('recent_post')
      .subQuery()
      .select('COUNT(*)')
      .from(Post, 'recent_post')
      .innerJoin(
        CommunityProfile,
        'recent_post_profile',
        'recent_post_profile.community_profile_id = recent_post.community_profile_id',
      )
      .where('recent_post_profile.community_id = community.id')
      .andWhere('recent_post.is_hidden = false')
      .andWhere(
        `recent_post.posted_at >= NOW() - INTERVAL '${RECENT_POST_DAYS} days'`,
      )
      .getQuery();

    const queryBuilder = this.communityRepository
      .createQueryBuilder('community')
      .leftJoinAndSelect('community.category', 'category')
      .addSelect(memberCountSubquery, 'member_count')
      .addSelect(recentPostCountSubquery, 'recent_post_count')
      .where('community.is_active = :isActive', { isActive: true });

    if (userId) {
      queryBuilder.innerJoin(
        'community.communityProfiles',
        'membership',
        'membership.user_id = :userId AND membership.removed_at IS NULL',
        { userId },
      );
      queryBuilder.addSelect('membership.role', 'membership_role');
    }

    if (query.search) {
      queryBuilder.andWhere('community.name ILIKE :search', {
        search: `%${query.search}%`,
      });
    }

    if (query.categoryId !== undefined) {
      queryBuilder.andWhere('community.category_id = :categoryId', {
        categoryId: query.categoryId,
      });
    }

    if (query.sort === 'popularity') {
      queryBuilder
        .orderBy('member_count', 'DESC')
        .addOrderBy('recent_post_count', 'DESC')
        .addOrderBy('community.created_at', 'DESC')
        .addOrderBy('community.id', 'ASC');
    } else {
      queryBuilder
        .orderBy('community.created_at', 'DESC')
        .addOrderBy('community.id', 'ASC');
    }

    return queryBuilder;
  }

  private buildAdminCommunityListQuery(query: GetAdminCommunitiesQueryDto) {
    const memberCountSubquery = this.communityRepository
      .createQueryBuilder('admin_member_profile')
      .subQuery()
      .select('COUNT(*)')
      .from(CommunityProfile, 'admin_member_profile')
      .where('admin_member_profile.community_id = community.id')
      .andWhere('admin_member_profile.removed_at IS NULL')
      .andWhere('admin_member_profile.removed_at IS NULL')
      .getQuery();

    const productCountSubquery = this.communityRepository
      .createQueryBuilder('admin_product')
      .subQuery()
      .select('COUNT(*)')
      .from(Product, 'admin_product')
      .where('admin_product.community_id = community.id')
      .andWhere('admin_product.deleted_at IS NULL')
      .getQuery();

    const pendingReportsCountSubquery = this.communityRepository
      .createQueryBuilder('admin_report')
      .subQuery()
      .select('COUNT(*)')
      .from(Report, 'admin_report')
      .where('admin_report.community_id = community.id')
      .andWhere('admin_report.status = :pendingReportStatus')
      .getQuery();

    const queryBuilder = this.communityRepository
      .createQueryBuilder('community')
      .withDeleted()
      .leftJoinAndSelect('community.category', 'category')
      .addSelect(memberCountSubquery, 'admin_member_count')
      .addSelect(productCountSubquery, 'admin_product_count')
      .addSelect(pendingReportsCountSubquery, 'admin_pending_reports_count')
      .setParameter('pendingReportStatus', ReportStatus.PENDING)
      .orderBy('community.created_at', 'DESC')
      .addOrderBy('community.id', 'ASC');

    if (query.search) {
      queryBuilder.andWhere(
        '(community.name ILIKE :adminSearch OR community.slug ILIKE :adminSearch OR community.description ILIKE :adminSearch)',
        { adminSearch: `%${query.search}%` },
      );
    }

    if (query.categoryId !== undefined) {
      queryBuilder.andWhere('community.category_id = :adminCategoryId', {
        adminCategoryId: query.categoryId,
      });
    }

    if (query.isActive !== undefined) {
      queryBuilder.andWhere('community.is_active = :adminIsActive', {
        adminIsActive: query.isActive,
      });
    }

    if (query.isPrivate !== undefined) {
      queryBuilder.andWhere('community.is_private = :adminIsPrivate', {
        adminIsPrivate: query.isPrivate,
      });
    }

    return queryBuilder;
  }

  private mapCommunityList(
    communities: Community[],
    rawRows: Record<string, unknown>[],
    includeMembershipRole = false,
  ) {
    return communities.map((community, index) => {
      const raw = rawRows[index] ?? {};
      const memberCount = this.toNumber(raw.member_count);
      const recentPostCount = this.toNumber(raw.recent_post_count);

      return {
        id: community.id,
        name: community.name,
        description: community.description,
        slug: community.slug,
        isPrivate: community.isPrivate,
        imageUrl: community.imageUrl,
        bannerUrl: community.bannerUrl,
        createdAt: community.createdAt,
        category: community.category,
        memberCount,
        recentPostCount,
        popularityScore: this.calculatePopularityScore(
          memberCount,
          recentPostCount,
        ),
        ...(includeMembershipRole
          ? { membershipRole: raw.membership_role }
          : {}),
      };
    });
  }

  private mapAdminCommunityList(
    communities: Community[],
    rawRows: Record<string, unknown>[],
  ) {
    return communities.map((community, index) => {
      const raw = rawRows[index] ?? {};
      return {
        id: community.id,
        name: community.name,
        slug: community.slug,
        description: community.description,
        isActive: community.isActive,
        isPrivate: community.isPrivate,
        category: community.category,
        memberCount: this.toNumber(raw.admin_member_count),
        productCount: this.toNumber(raw.admin_product_count),
        pendingReportsCount: this.toNumber(raw.admin_pending_reports_count),
        createdAt: community.createdAt,
        deletedAt: community.deletedAt,
      };
    });
  }

  private calculatePopularityScore(
    memberCount: number,
    recentPostCount: number,
  ): number {
    return 0.7 * Math.log1p(memberCount) + 0.3 * Math.log1p(recentPostCount);
  }

  private toNumber(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private buildPagination(page: number, limit: number, total: number) {
    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  findAllCategories(): Promise<Category[]> {
    return this.categoryRepository.find({
      where: { isActive: true },
      order: { categoryId: 'ASC' },
    });
  }

  findInactiveCategories(): Promise<Category[]> {
    return this.categoryRepository.find({
      where: { isActive: false },
      order: { categoryId: 'ASC' },
    });
  }

  async createCategory(dto: CreateCategoryDto): Promise<Category> {
    const name = dto.name.trim();
    const existingCategory = await this.findCategoryByNormalizedName(name);

    if (existingCategory) {
      throw new ConflictException('Ya existe una categoría con ese nombre');
    }

    try {
      return await this.categoryRepository.save(
        this.categoryRepository.create({ name, isActive: true }),
      );
    } catch (error: unknown) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as PostgresError).code === '23505'
      ) {
        throw new ConflictException('Ya existe una categoría con ese nombre');
      }

      throw new InternalServerErrorException(
        'Ocurrió un error al crear la categoría',
      );
    }
  }

  async activateCategory(categoryId: number): Promise<Category> {
    return this.updateCategoryStatus(categoryId, true);
  }

  async deactivateCategory(categoryId: number): Promise<Category> {
    return this.updateCategoryStatus(categoryId, false);
  }

  private findCategoryByNormalizedName(name: string): Promise<Category | null> {
    return this.categoryRepository
      .createQueryBuilder('category')
      .where('LOWER(BTRIM(category.name)) = LOWER(:name)', { name })
      .getOne();
  }

  private async updateCategoryStatus(
    categoryId: number,
    isActive: boolean,
  ): Promise<Category> {
    const category = await this.categoryRepository.findOne({
      where: { categoryId },
    });

    if (!category) {
      throw new NotFoundException('Categoría no encontrada');
    }

    category.isActive = isActive;
    return this.categoryRepository.save(category);
  }

  async createTag(dto: CreateTagDto): Promise<Tag> {
    const existingTag = await this.tagRepository.findOne({
      where: { name: dto.name },
    });

    if (existingTag) {
      throw new ConflictException('Ya existe un tag con ese nombre');
    }

    if (dto.categoryId !== undefined) {
      const category = await this.categoryRepository.findOne({
        where: { categoryId: dto.categoryId, isActive: true },
      });
      if (!category) {
        throw new NotFoundException('La categoría seleccionada no existe');
      }
    }

    try {
      return await this.tagRepository.save(
        this.tagRepository.create({
          name: dto.name,
          categoryId: dto.categoryId ?? null,
        }),
      );
    } catch (error: unknown) {
      if (error instanceof QueryFailedError) {
        const databaseError = error.driverError as PostgresError;

        if (
          databaseError.code === '23505' &&
          databaseError.constraint === 'UQ_tag_name'
        ) {
          throw new ConflictException('Ya existe un tag con ese nombre');
        }
      }

      throw new InternalServerErrorException(
        'Ocurrió un error al crear el tag',
      );
    }
  }

  async findAllTags(query: GetTagsQueryDto) {
    const { page, limit, isInterest, categoryId } = query;
    const where: FindOptionsWhere<Tag> = {};
    if (isInterest !== undefined) where.isInterest = isInterest;
    if (categoryId !== undefined) where.categoryId = categoryId;

    const [data, total] = await this.tagRepository.findAndCount({
      where,
      order: { tagId: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findTagById(tagId: number): Promise<Tag> {
    const tag = await this.tagRepository.findOne({ where: { tagId } });
    if (!tag) {
      throw new NotFoundException('Tag no encontrado');
    }
    return tag;
  }

  async updateTag(tagId: number, dto: UpdateTagDto): Promise<Tag> {
    const tag = await this.findTagById(tagId);

    if (dto.name && dto.name !== tag.name) {
      const existingTag = await this.tagRepository.findOne({
        where: { name: dto.name },
      });
      if (existingTag) {
        throw new ConflictException('Ya existe un tag con ese nombre');
      }
      tag.name = dto.name;
    }

    if (dto.categoryId !== undefined) {
      if (dto.categoryId !== null) {
        const category = await this.categoryRepository.findOne({
          where: { categoryId: dto.categoryId, isActive: true },
        });
        if (!category) {
          throw new NotFoundException('La categoría seleccionada no existe');
        }
      }
      tag.categoryId = dto.categoryId;
    }

    if (dto.isInterest !== undefined) {
      tag.isInterest = dto.isInterest;
    }

    try {
      return await this.tagRepository.save(tag);
    } catch (error: unknown) {
      if (error instanceof QueryFailedError) {
        const databaseError = error.driverError as PostgresError;
        if (
          databaseError.code === '23505' &&
          databaseError.constraint === 'UQ_tag_name'
        ) {
          throw new ConflictException('Ya existe un tag con ese nombre');
        }
      }
      throw new InternalServerErrorException(
        'Ocurrió un error al actualizar el tag',
      );
    }
  }

  async deleteTag(tagId: number): Promise<void> {
    const tag = await this.findTagById(tagId);

    try {
      await this.tagRepository.remove(tag);
    } catch (error: unknown) {
      if (error instanceof QueryFailedError) {
        const databaseError = error.driverError as PostgresError;
        if (databaseError.code === '23001' || databaseError.code === '23503') {
          throw new ConflictException(
            'No se puede eliminar un tag que está siendo usado por una comunidad',
          );
        }
      }
      throw new InternalServerErrorException(
        'Ocurrió un error al eliminar el tag',
      );
    }
  }

  async findAllRules(communityId: number): Promise<CommunityRuleSummary[]> {
    await this.ensureCommunityExists(communityId);

    return this.communityRuleRepository.find({
      where: { communityId },
      select: {
        communityRuleId: true,
        description: true,
      },
      order: { communityRuleId: 'ASC' },
    });
  }

  async createRule(
    communityId: number,
    dto: CreateCommunityRuleDto,
  ): Promise<CommunityRule[]> {
    await this.ensureCommunityExists(communityId);

    if (new Set(dto.description).size !== dto.description.length) {
      throw new ConflictException(
        'No puede repetir reglas en la misma petición',
      );
    }

    const duplicateRules = await this.communityRuleRepository.find({
      where: { communityId, description: In(dto.description) },
    });

    if (duplicateRules.length > 0) {
      throw new ConflictException(
        'La comunidad ya tiene una regla con esa descripción',
      );
    }

    const rules = dto.description.map((description) =>
      this.communityRuleRepository.create({
        communityId,
        description,
      }),
    );

    try {
      return await this.dataSource.transaction((manager) =>
        manager.save(CommunityRule, rules),
      );
    } catch (error: unknown) {
      this.handleCommunityRuleDatabaseError(error, 'crear');
    }
  }

  async updateRule(
    communityId: number,
    ruleId: number,
    dto: UpdateCommunityRuleDto,
  ): Promise<CommunityRule> {
    await this.ensureCommunityExists(communityId);

    const rule = await this.communityRuleRepository.findOne({
      where: { communityRuleId: ruleId, communityId },
    });

    if (!rule) {
      throw new NotFoundException('Regla no encontrada en esta comunidad');
    }

    const duplicateRule = await this.communityRuleRepository.findOne({
      where: { communityId, description: dto.description },
    });

    if (duplicateRule && duplicateRule.communityRuleId !== ruleId) {
      throw new ConflictException(
        'La comunidad ya tiene una regla con esa descripción',
      );
    }

    rule.description = dto.description;

    try {
      return await this.communityRuleRepository.save(rule);
    } catch (error: unknown) {
      this.handleCommunityRuleDatabaseError(error, 'actualizar');
    }
  }

  async deleteRule(
    communityId: number,
    ruleId: number,
  ): Promise<{ message: string }> {
    await this.ensureCommunityExists(communityId);

    const rule = await this.communityRuleRepository.findOne({
      where: { communityRuleId: ruleId, communityId },
    });

    if (!rule) {
      throw new NotFoundException('Regla no encontrada en esta comunidad');
    }

    try {
      await this.communityRuleRepository.remove(rule);
      return { message: 'Regla eliminada exitosamente' };
    } catch {
      throw new InternalServerErrorException(
        'Ocurrió un error al eliminar la regla',
      );
    }
  }

  async update(
    communityId: number,
    dto: UpdateCommunityDto,
    image: Express.Multer.File | undefined,
    banner: Express.Multer.File | undefined,
  ): Promise<Community> {
    const community = await this.communityRepository.findOne({
      where: { id: communityId },
    });

    if (!community) {
      throw new NotFoundException('Comunidad no encontrada');
    }

    this.validateUpdateCollections(dto);

    const [communityWithName, category, tags] = await Promise.all([
      dto.name !== undefined
        ? this.communityRepository.findOne({ where: { name: dto.name } })
        : Promise.resolve(null),
      dto.categoryId !== undefined
        ? this.categoryRepository.findOne({
            where: { categoryId: dto.categoryId, isActive: true },
          })
        : Promise.resolve(null),
      dto.tagIds !== undefined
        ? this.tagRepository.find({ where: { tagId: In(dto.tagIds) } })
        : Promise.resolve([] as Tag[]),
    ]);

    if (communityWithName && communityWithName.id !== communityId) {
      throw new ConflictException('Ya existe una comunidad con ese nombre');
    }

    if (dto.categoryId !== undefined && !category) {
      throw new NotFoundException('La categoría seleccionada no existe');
    }

    if (dto.tagIds !== undefined) {
      const existingTagIds = new Set(tags.map((tag) => tag.tagId));
      const missingTagIds = dto.tagIds.filter(
        (tagId) => !existingTagIds.has(tagId),
      );

      if (missingTagIds.length > 0) {
        throw new NotFoundException(
          `No existen los siguientes tags: ${missingTagIds.join(', ')}`,
        );
      }
    }

    let newImageUrl: string | undefined;
    let newBannerUrl: string | undefined;
    const filesToUpload: Express.Multer.File[] = [];

    if (image) filesToUpload.push(image);
    if (banner) filesToUpload.push(banner);

    if (filesToUpload.length > 0) {
      const uploads = await this.uploadImages(filesToUpload);
      let uploadIndex = 0;

      if (image) {
        newImageUrl = uploads[uploadIndex].url;
        uploadIndex += 1;
      }

      if (banner) {
        newBannerUrl = uploads[uploadIndex].url;
      }
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const currentCommunity = await manager.findOne(Community, {
          where: { id: communityId },
        });

        if (!currentCommunity) {
          throw new NotFoundException('Comunidad no encontrada');
        }

        if (dto.name !== undefined) currentCommunity.name = dto.name;
        if (dto.description !== undefined) {
          currentCommunity.description = dto.description;
        }
        if (dto.categoryId !== undefined) {
          currentCommunity.categoryId = dto.categoryId;
        }
        if (newImageUrl !== undefined) {
          currentCommunity.imageUrl = newImageUrl;
        }
        if (newBannerUrl !== undefined) {
          currentCommunity.bannerUrl = newBannerUrl;
        }

        await manager.save(Community, currentCommunity);

        if (dto.tagIds !== undefined) {
          await manager.delete(CommunityTag, { communityId });

          const communityTags = dto.tagIds.map((tagId) =>
            manager.create(CommunityTag, { communityId, tagId }),
          );
          await manager.save(CommunityTag, communityTags);
        }

        if (dto.rules !== undefined) {
          await manager.delete(CommunityRule, { communityId });

          const communityRules = dto.rules.map((description) =>
            manager.create(CommunityRule, {
              communityId,
              description,
            }),
          );

          if (communityRules.length > 0) {
            await manager.save(CommunityRule, communityRules);
          }
        }

        const result = await manager.findOne(Community, {
          where: { id: communityId },
          relations: {
            category: true,
            communityTags: { tag: true },
            rules: true,
          },
        });

        if (!result) {
          throw new InternalServerErrorException(
            'No fue posible recuperar la comunidad actualizada',
          );
        }

        return result;
      });
    } catch (error: unknown) {
      this.handleUpdateDatabaseError(error);
    }
  }

  async deactivate(
    communityId: number,
    actorUserId?: string,
  ): Promise<{ message: string }> {
    if (await this.isSuperAdmin(actorUserId)) {
      return this.changeCommunityStateAsSuperAdmin(
        communityId,
        actorUserId!,
        'isActive',
        false,
        MODERATION_ACTIONS.COMMUNITY_DEACTIVATED,
        NotificationType.COMMUNITY_DEACTIVATED,
        'Comunidad desactivada por administración',
        'Comunidad desactivada exitosamente',
      );
    }

    const community = await this.communityRepository.findOne({
      where: { id: communityId },
    });

    if (!community) {
      throw new NotFoundException('Comunidad no encontrada');
    }

    if (!community.isActive) {
      return { message: 'Comunidad desactivada exitosamente' };
    }

    community.isActive = false;

    try {
      await this.communityRepository.save(community);
      return { message: 'Comunidad desactivada exitosamente' };
    } catch {
      throw new InternalServerErrorException(
        'Ocurrió un error al desactivar la comunidad',
      );
    }
  }

  async activate(
    communityId: number,
    actorUserId?: string,
  ): Promise<{ message: string }> {
    if (await this.isSuperAdmin(actorUserId)) {
      return this.changeCommunityStateAsSuperAdmin(
        communityId,
        actorUserId!,
        'isActive',
        true,
        MODERATION_ACTIONS.COMMUNITY_ACTIVATED,
        NotificationType.COMMUNITY_ACTIVATED,
        'Comunidad activada por administración',
        'Comunidad activada exitosamente',
      );
    }

    const community = await this.communityRepository.findOne({
      where: { id: communityId },
    });

    if (!community) {
      throw new NotFoundException('Comunidad no encontrada');
    }

    if (community.isActive) {
      return { message: 'Comunidad activada exitosamente' };
    }

    community.isActive = true;

    try {
      await this.communityRepository.save(community);
      return { message: 'Comunidad activada exitosamente' };
    } catch {
      throw new InternalServerErrorException(
        'Ocurrió un error al activar la comunidad',
      );
    }
  }

  async makePublic(
    communityId: number,
    actorUserId?: string,
  ): Promise<{ message: string }> {
    if (await this.isSuperAdmin(actorUserId)) {
      return this.changeCommunityStateAsSuperAdmin(
        communityId,
        actorUserId!,
        'isPrivate',
        false,
        MODERATION_ACTIONS.COMMUNITY_MADE_PUBLIC,
        NotificationType.COMMUNITY_MADE_PUBLIC,
        'Comunidad configurada como pública por administración',
        'Comunidad configurada como pública exitosamente',
      );
    }

    const community = await this.communityRepository.findOne({
      where: { id: communityId },
    });

    if (!community) {
      throw new NotFoundException('Comunidad no encontrada');
    }

    if (!community.isPrivate) {
      return { message: 'Comunidad configurada como pública exitosamente' };
    }

    community.isPrivate = false;

    try {
      await this.communityRepository.save(community);
      return { message: 'Comunidad configurada como pública exitosamente' };
    } catch {
      throw new InternalServerErrorException(
        'Ocurrió un error al cambiar la comunidad a pública',
      );
    }
  }

  async makePrivate(
    communityId: number,
    actorUserId?: string,
  ): Promise<{ message: string }> {
    if (await this.isSuperAdmin(actorUserId)) {
      return this.changeCommunityStateAsSuperAdmin(
        communityId,
        actorUserId!,
        'isPrivate',
        true,
        MODERATION_ACTIONS.COMMUNITY_MADE_PRIVATE,
        NotificationType.COMMUNITY_MADE_PRIVATE,
        'Comunidad configurada como privada por administración',
        'Comunidad configurada como privada exitosamente',
      );
    }

    const community = await this.communityRepository.findOne({
      where: { id: communityId },
    });

    if (!community) {
      throw new NotFoundException('Comunidad no encontrada');
    }

    if (community.isPrivate) {
      return { message: 'Comunidad configurada como privada exitosamente' };
    }

    community.isPrivate = true;

    try {
      await this.communityRepository.save(community);
      return { message: 'Comunidad configurada como privada exitosamente' };
    } catch {
      throw new InternalServerErrorException(
        'Ocurrió un error al cambiar la comunidad a privada',
      );
    }
  }

  async deleteCommunity(
    communityId: number,
    actorUserId: string,
    dto: DeleteCommunityDto,
  ): Promise<void> {
    const reason = dto.reason.trim();
    if (!reason || reason.length > 500) {
      throw new BadRequestException(
        'El motivo de eliminación es obligatorio y no puede superar 500 caracteres',
      );
    }

    if (!this.moderationActionsService || !this.notificationsService) {
      throw new InternalServerErrorException(
        'La moderación administrativa no está configurada',
      );
    }

    let changed = false;
    let communityName = '';

    await this.dataSource.transaction(async (manager) => {
      const communityRepository = manager.getRepository(Community);
      const community = await communityRepository.findOne({
        where: { id: communityId },
        withDeleted: true,
        lock: { mode: 'pessimistic_write' },
      });

      if (!community) {
        throw new NotFoundException('Comunidad no encontrada');
      }

      if (community.deletedAt) return;

      communityName = community.name;
      await communityRepository.softDelete(communityId);
      await this.moderationActionsService!.record(
        {
          actorUserId,
          targetType: MODERATION_TARGET_TYPES.COMMUNITY,
          targetId: communityId,
          action: MODERATION_ACTIONS.COMMUNITY_SOFT_DELETED,
          reason,
          communityId,
        },
        manager,
      );
      changed = true;
    });

    if (!changed) return;

    const recipientIds =
      await this.findCommunityModerationRecipients(communityId);
    try {
      await this.notificationsService.notify(
        recipientIds.map((userId) => ({
          userId,
          type: NotificationType.COMMUNITY_DELETED,
          data: {
            communityId,
            communityName,
            reason,
            actorUserId,
          },
          message: `${communityName}: comunidad eliminada por administración`,
        })),
      );
    } catch {
      // La eliminación y su auditoría ya fueron confirmadas.
    }
  }

  private async isSuperAdmin(actorUserId?: string): Promise<boolean> {
    if (!actorUserId) return false;
    const actor = await this.usersService.findById(actorUserId);
    return actor.role === UserRole.SUPERADMIN;
  }

  private async changeCommunityStateAsSuperAdmin(
    communityId: number,
    actorUserId: string,
    field: 'isActive' | 'isPrivate',
    value: boolean,
    action: ModerationActionType,
    notificationType: NotificationType,
    notificationMessage: string,
    successMessage: string,
  ): Promise<{ message: string }> {
    if (!this.moderationActionsService || !this.notificationsService) {
      throw new InternalServerErrorException(
        'La moderación administrativa no está configurada',
      );
    }

    let changed = false;
    let communityName = '';

    await this.dataSource.transaction(async (manager) => {
      const communityRepository = manager.getRepository(Community);
      const community = await communityRepository.findOne({
        where: { id: communityId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!community) {
        throw new NotFoundException('Comunidad no encontrada');
      }

      const currentValue =
        field === 'isActive' ? community.isActive : community.isPrivate;
      communityName = community.name;

      if (currentValue === value) return;

      if (field === 'isActive') {
        community.isActive = value;
      } else {
        community.isPrivate = value;
      }

      await communityRepository.save(community);
      await this.moderationActionsService!.record(
        {
          actorUserId,
          targetType: MODERATION_TARGET_TYPES.COMMUNITY,
          targetId: community.id,
          action,
          reason: null,
          communityId: community.id,
        },
        manager,
      );
      changed = true;
    });

    if (changed) {
      const recipientIds =
        await this.findCommunityModerationRecipients(communityId);
      try {
        await this.notificationsService.notify(
          recipientIds.map((userId) => ({
            userId,
            type: notificationType,
            data: {
              communityId,
              communityName,
              action,
              actorUserId,
            },
            message: `${communityName}: ${notificationMessage}`,
          })),
        );
      } catch {
        // La acción y su auditoría ya fueron confirmadas; una falla de
        // notificación no debe revertir la operación administrativa.
      }
    }

    return { message: successMessage };
  }

  private async findCommunityModerationRecipients(
    communityId: number,
  ): Promise<string[]> {
    const profiles = await this.communityProfileRepository.find({
      where: {
        communityId,
        role: In([CommunityProfileRole.OWNER, CommunityProfileRole.MODERATOR]),
      },
      relations: { user: true },
    });

    return [
      ...new Set(
        profiles
          .filter((profile) => profile.user?.isActive !== false)
          .map((profile) => profile.userId),
      ),
    ];
  }

  private validateCollections(dto: CreateCommunityDto): void {
    if (dto.tagIds.length < 1 || dto.tagIds.length > 3) {
      throw new BadRequestException(
        'Una comunidad debe tener entre uno y tres tags',
      );
    }

    if (new Set(dto.tagIds).size !== dto.tagIds.length) {
      throw new BadRequestException('No puede repetir tags en una comunidad');
    }

    if (new Set(dto.rules).size !== dto.rules.length) {
      throw new BadRequestException('No puede repetir reglas en una comunidad');
    }
  }

  private async ensureCommunityExists(communityId: number): Promise<void> {
    const community = await this.communityRepository.findOne({
      where: { id: communityId },
      select: { id: true },
    });

    if (!community) {
      throw new NotFoundException('Comunidad no encontrada');
    }
  }

  private async ensureActiveCommunityExists(
    communityId: number,
  ): Promise<void> {
    const community = await this.communityRepository.findOne({
      where: { id: communityId, isActive: true },
      select: { id: true },
    });

    if (!community) {
      throw new NotFoundException('Comunidad no encontrada');
    }
  }

  private validateUpdateCollections(dto: UpdateCommunityDto): void {
    if (
      dto.tagIds !== undefined &&
      (dto.tagIds.length < 1 || dto.tagIds.length > 3)
    ) {
      throw new BadRequestException(
        'Una comunidad debe tener entre uno y tres tags',
      );
    }

    if (
      dto.tagIds !== undefined &&
      new Set(dto.tagIds).size !== dto.tagIds.length
    ) {
      throw new BadRequestException('No puede repetir tags en una comunidad');
    }

    if (
      dto.rules !== undefined &&
      new Set(dto.rules).size !== dto.rules.length
    ) {
      throw new BadRequestException('No puede repetir reglas en una comunidad');
    }
  }

  private async uploadImages(
    files: Express.Multer.File[],
  ): Promise<{ url: string }[]> {
    try {
      return await this.cloudinaryService.uploadImages(files);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;

      throw new BadGatewayException(
        'No fue posible subir las imágenes de la comunidad',
      );
    }
  }

  private async getForumPostMetrics(
    posts: Post[],
    communityProfileId: number | undefined,
    userId: string | undefined,
  ) {
    const metrics = new Map<
      number,
      {
        upVotes: number;
        downVotes: number;
        timesSaved: number;
        myVote: string | null;
        isSaved: boolean;
      }
    >();
    const postIds = posts.map((post) => post.id);

    if (
      postIds.length === 0 ||
      !this.postVoteRepository ||
      !this.favoriteRepository
    ) {
      return metrics;
    }

    const [votes, favorites] = await Promise.all([
      this.postVoteRepository.find({ where: { postId: In(postIds) } }),
      this.favoriteRepository.find({
        where: { itemId: In(postIds), itemType: FavoriteItemType.POST },
      }),
    ]);

    for (const postId of postIds) {
      const postVotes = votes.filter((vote) => vote.postId === postId);
      metrics.set(postId, {
        upVotes: postVotes.filter((vote) => vote.voteType === VoteType.UP)
          .length,
        downVotes: postVotes.filter((vote) => vote.voteType === VoteType.DOWN)
          .length,
        timesSaved: favorites.filter((favorite) => favorite.itemId === postId)
          .length,
        myVote:
          postVotes.find(
            (vote) => vote.communityProfileId === communityProfileId,
          )?.voteType ?? null,
        isSaved: favorites.some(
          (favorite) =>
            favorite.itemId === postId && favorite.userId === userId,
        ),
      });
    }

    return metrics;
  }

  private emptyForumPostMetric() {
    return {
      upVotes: 0,
      downVotes: 0,
      timesSaved: 0,
      myVote: null,
      isSaved: false,
    };
  }

  private handleDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;

    if (error instanceof QueryFailedError) {
      const databaseError = error.driverError as PostgresError;

      if (databaseError.code === '23505') {
        if (databaseError.constraint === 'UQ_community_name') {
          throw new ConflictException('Ya existe una comunidad con ese nombre');
        }

        if (databaseError.constraint === 'UQ_community_slug') {
          throw new ConflictException('Ya existe una comunidad con ese slug');
        }

        if (
          databaseError.constraint === 'UQ_community_tag_community_id_tag_id'
        ) {
          throw new BadRequestException(
            'No puede repetir tags en una comunidad',
          );
        }

        throw new ConflictException(
          'No fue posible crear la comunidad debido a datos duplicados',
        );
      }
    }

    throw new InternalServerErrorException(
      'Ocurrió un error al crear la comunidad',
    );
  }

  private handleUpdateDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;

    if (error instanceof QueryFailedError) {
      const databaseError = error.driverError as PostgresError;

      if (databaseError.code === '23505') {
        if (databaseError.constraint === 'UQ_community_name') {
          throw new ConflictException('Ya existe una comunidad con ese nombre');
        }

        if (
          databaseError.constraint === 'UQ_community_tag_community_id_tag_id'
        ) {
          throw new BadRequestException(
            'No puede repetir tags en una comunidad',
          );
        }

        throw new ConflictException(
          'No fue posible actualizar la comunidad debido a datos duplicados',
        );
      }
    }

    throw new InternalServerErrorException(
      'Ocurrió un error al actualizar la comunidad',
    );
  }

  private handleCommunityRuleDatabaseError(
    error: unknown,
    action: 'crear' | 'actualizar',
  ): never {
    if (error instanceof QueryFailedError) {
      const databaseError = error.driverError as PostgresError;

      if (
        databaseError.code === '23505' &&
        databaseError.constraint ===
          'UQ_community_rule_community_id_description'
      ) {
        throw new ConflictException(
          'La comunidad ya tiene una regla con esa descripción',
        );
      }
    }

    throw new InternalServerErrorException(
      `Ocurrió un error al ${action} la regla`,
    );
  }
}
