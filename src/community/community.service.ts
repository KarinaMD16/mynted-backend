import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  FindOptionsWhere,
  In,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { CreateCommunityRuleDto } from './dto/create-community-rule.dto';
import { CreateTagDto } from './dto/create-tag.dto';
import { GetTagsQueryDto } from './dto/get-tags-query.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';
import { UpdateCommunityRuleDto } from './dto/update-community-rule.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { GetCommunitiesQueryDto } from './dto/get-communities-query.dto';
import {
  CommunityProfile,
  CommunityProfileRole,
} from './entities/community-profile.entity';
import { Category } from './entities/category.entity';
import { CommunityRule } from './entities/community-rule.entity';
import { CommunityTag } from './entities/community-tag.entity';
import { Community } from './entities/community.entity';
import { Tag } from './entities/tag.entity';
import { Post } from './entities/post.entity';
import { UsersService } from '../users/users.service';

interface PostgresError {
  code?: string;
  constraint?: string;
}

type CommunityRuleSummary = Pick<
  CommunityRule,
  'communityRuleId' | 'description'
>;

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
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
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
          where: { categoryId: dto.categoryId },
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

    const user = await this.usersService.findById(userId);

    try {
      return await this.dataSource.transaction(async (manager) => {
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

        const creatorProfile = manager.create(CommunityProfile, {
          displayName: user.username,
          bio: '',
          role: CommunityProfileRole.OWNER,
          userId,
          communityId: savedCommunity.id,
        });
        await manager.save(CommunityProfile, creatorProfile);

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

    const [memberCount, recentPostCount, membership, forumPosts] =
      await Promise.all([
        this.communityProfileRepository.count({ where: { communityId } }),
        this.countRecentPosts(communityId),
        this.communityProfileRepository.findOne({
          where: { userId, communityId },
          select: { role: true },
        }),
        this.findRecentForumPosts(communityId),
      ]);

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
        upVotes: post.upVotes,
        downVotes: post.downVotes,
        timesSaved: post.timesSaved,
        author: post.communityProfile
          ? {
              communityProfileId: post.communityProfile.communityProfileId,
              displayName: post.communityProfile.displayName,
              role: post.communityProfile.role,
            }
          : null,
      })),
    };
  }

  private countRecentPosts(communityId: number): Promise<number> {
    return this.postRepository
      .createQueryBuilder('post')
      .innerJoin(
        CommunityProfile,
        'recent_post_profile',
        'recent_post_profile.community_profile_id = post.community_profile_id',
      )
      .where('recent_post_profile.community_id = :communityId', {
        communityId,
      })
      .andWhere(`post.posted_at >= NOW() - INTERVAL '${RECENT_POST_DAYS} days'`)
      .getCount();
  }

  private findRecentForumPosts(communityId: number): Promise<Post[]> {
    return this.postRepository
      .createQueryBuilder('post')
      .innerJoinAndSelect('post.communityProfile', 'communityProfile')
      .where('communityProfile.community_id = :communityId', {
        communityId,
      })
      .orderBy('post.posted_at', 'DESC')
      .take(10)
      .getMany();
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
        'membership.user_id = :userId',
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
    return this.categoryRepository.find({ order: { categoryId: 'ASC' } });
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
        where: { categoryId: dto.categoryId },
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
          where: { categoryId: dto.categoryId },
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
    id: number,
    dto: UpdateCommunityDto,
    image: Express.Multer.File | undefined,
    banner: Express.Multer.File | undefined,
  ): Promise<Community> {
    const community = await this.communityRepository.findOne({
      where: { id },
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
            where: { categoryId: dto.categoryId },
          })
        : Promise.resolve(null),
      dto.tagIds !== undefined
        ? this.tagRepository.find({ where: { tagId: In(dto.tagIds) } })
        : Promise.resolve([] as Tag[]),
    ]);

    if (communityWithName && communityWithName.id !== id) {
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
          where: { id },
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
          await manager.delete(CommunityTag, { communityId: id });

          const communityTags = dto.tagIds.map((tagId) =>
            manager.create(CommunityTag, { communityId: id, tagId }),
          );
          await manager.save(CommunityTag, communityTags);
        }

        if (dto.rules !== undefined) {
          await manager.delete(CommunityRule, { communityId: id });

          const communityRules = dto.rules.map((description) =>
            manager.create(CommunityRule, {
              communityId: id,
              description,
            }),
          );

          if (communityRules.length > 0) {
            await manager.save(CommunityRule, communityRules);
          }
        }

        const result = await manager.findOne(Community, {
          where: { id },
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

  async deactivate(id: number): Promise<{ message: string }> {
    const community = await this.communityRepository.findOne({
      where: { id },
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

  async activate(id: number): Promise<{ message: string }> {
    const community = await this.communityRepository.findOne({
      where: { id },
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

  async makePublic(id: number): Promise<{ message: string }> {
    const community = await this.communityRepository.findOne({
      where: { id },
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

  async makePrivate(id: number): Promise<{ message: string }> {
    const community = await this.communityRepository.findOne({
      where: { id },
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
