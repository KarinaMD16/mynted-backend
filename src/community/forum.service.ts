import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { Product, ProductStatus } from '../products/entities/product.entity';
import { CreatePostDto } from './dto/create-post.dto';
import { CreateReplyDto } from './dto/create-reply.dto';
import { GetPostsQueryDto } from './dto/get-posts-query.dto';
import { GetGlobalPostsQueryDto } from './dto/get-global-posts-query.dto';
import {
  GetMyPostsQueryDto,
  MyPostsSortBy,
  SortOrder,
} from './dto/get-my-posts-query.dto';
import { GetMyFeedQueryDto } from './dto/get-my-feed-query.dto';
import {
  ContentType,
  GetMyContentQueryDto,
} from './dto/get-my-content-query.dto';
import { VoteDto } from './dto/vote.dto';
import { CommunityProfile } from './entities/community-profile.entity';
import { Community } from './entities/community.entity';
import { Favorite, FavoriteItemType } from './entities/favorite.entity';
import { PostImage } from './entities/post-image.entity';
import { PostTag } from './entities/post-tag.entity';
import { PostVote } from './entities/post-vote.entity';
import { Post } from './entities/post.entity';
import { ReplyVote } from './entities/reply-vote.entity';
import { Reply } from './entities/reply.entity';
import { Tag } from './entities/tag.entity';
import { VoteType } from './entities/vote-type.enum';

interface PostFiles {
  images?: Express.Multer.File[];
}

interface ContentEntry {
  type: 'post' | 'product';
  id: number;
  date: Date;
}

interface PostMetric {
  upVotes: number;
  downVotes: number;
  timesSaved: number;
  myVote: VoteType | null;
  isSaved: boolean;
}

@Injectable()
export class ForumService {
  constructor(
    @InjectRepository(Community)
    private readonly communityRepository: Repository<Community>,
    @InjectRepository(CommunityProfile)
    private readonly communityProfileRepository: Repository<CommunityProfile>,
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
    @InjectRepository(PostTag)
    private readonly postTagRepository: Repository<PostTag>,
    @InjectRepository(PostImage)
    private readonly postImageRepository: Repository<PostImage>,
    @InjectRepository(Tag)
    private readonly tagRepository: Repository<Tag>,
    @InjectRepository(Reply)
    private readonly replyRepository: Repository<Reply>,
    @InjectRepository(PostVote)
    private readonly postVoteRepository: Repository<PostVote>,
    @InjectRepository(ReplyVote)
    private readonly replyVoteRepository: Repository<ReplyVote>,
    @InjectRepository(Favorite)
    private readonly favoriteRepository: Repository<Favorite>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly dataSource: DataSource,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async createPost(
    communityId: number,
    userId: string,
    dto: CreatePostDto,
    files: PostFiles,
  ) {
    const community = await this.getActiveCommunity(communityId);
    const profile = await this.getMemberProfile(userId, communityId);
    const tags = await this.getTags(dto.tagIds);
    const uploads =
      files.images && files.images.length > 0
        ? await this.cloudinaryService.uploadImages(files.images)
        : [];

    const postId = await this.dataSource.transaction(async (manager) => {
      const post = manager.create(Post, {
        title: dto.title,
        body: dto.body,
        communityProfileId: profile.communityProfileId,
      });
      const savedPost = await manager.save(Post, post);

      if (tags.length > 0) {
        await manager.save(
          PostTag,
          tags.map((tag) =>
            manager.create(PostTag, {
              postId: savedPost.id,
              tagId: tag.tagId,
            }),
          ),
        );
      }

      if (uploads.length > 0) {
        await manager.save(
          PostImage,
          uploads.map((upload, index) =>
            manager.create(PostImage, {
              postId: savedPost.id,
              url: upload.url,
              order: index + 1,
            }),
          ),
        );
      }

      return savedPost.id;
    });

    return this.findPost(postId, userId, community);
  }

  async findPosts(
    communityId: number,
    userId: string,
    query: GetPostsQueryDto,
  ) {
    await this.getActiveCommunity(communityId);
    const profile = await this.communityProfileRepository.findOne({
      where: { userId, communityId },
      select: { communityProfileId: true },
    });
    const [posts, total] = await this.postRepository.findAndCount({
      where: { communityProfile: { communityId } },
      relations: {
        communityProfile: true,
        postTags: { tag: true },
        images: true,
      },
      order: { postedAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    const metrics = await this.getPostMetrics(
      posts.map((post) => post.id),
      profile?.communityProfileId,
      userId,
    );
    const replyCounts = await this.getReplyCounts(posts.map((post) => post.id));

    return {
      data: posts.map((post) =>
        this.mapPost(post, metrics.get(post.id), replyCounts.get(post.id) ?? 0),
      ),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async findGlobalPosts(userId: string, query: GetGlobalPostsQueryDto) {
    const queryBuilder = this.postRepository
      .createQueryBuilder('post')
      .innerJoinAndSelect('post.communityProfile', 'communityProfile')
      .innerJoinAndSelect('communityProfile.community', 'community')
      .leftJoinAndSelect('post.postTags', 'postTag')
      .leftJoinAndSelect('postTag.tag', 'tag')
      .leftJoinAndSelect('post.images', 'image')
      // Política actual del feed global: solo comunidades públicas activas.
      .where('community.is_active = :isActive', { isActive: true })
      .andWhere('community.is_private = :isPrivate', { isPrivate: false })
      .distinct(true)
      .orderBy('post.posted_at', 'DESC')
      .addOrderBy('post.id', 'DESC');

    const search = query.search?.trim();
    if (search) {
      queryBuilder.andWhere(
        '(post.title ILIKE :search OR post.body ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    if (query.tagIds && query.tagIds.length > 0) {
      queryBuilder.andWhere(
        `EXISTS (
          SELECT 1
          FROM post_tag global_feed_filter_post_tag
          WHERE global_feed_filter_post_tag.post_id = post.id
            AND global_feed_filter_post_tag.tag_id IN (:...tagIds)
        )`,
        { tagIds: query.tagIds },
      );
    }

    const [posts, total] = await queryBuilder
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    const communityIds = [
      ...new Set(
        posts
          .map((post) => post.communityProfile?.communityId)
          .filter(
            (communityId): communityId is number => communityId !== undefined,
          ),
      ),
    ];
    const profiles = communityIds.length
      ? await this.communityProfileRepository.find({
          where: { userId, communityId: In(communityIds) },
          select: { communityProfileId: true, communityId: true },
        })
      : [];
    const profileByCommunityId = new Map(
      profiles.map((profile) => [
        profile.communityId,
        profile.communityProfileId,
      ]),
    );
    const profileByPostId = new Map(
      posts.map((post) => [
        post.id,
        profileByCommunityId.get(post.communityProfile.communityId),
      ]),
    );
    const metrics = await this.getPostMetrics(
      posts.map((post) => post.id),
      undefined,
      userId,
      profileByPostId,
    );
    const replyCounts = await this.getReplyCounts(posts.map((post) => post.id));

    return {
      data: posts.map((post) => ({
        ...this.mapPost(
          post,
          metrics.get(post.id),
          replyCounts.get(post.id) ?? 0,
        ),
        community: post.communityProfile.community
          ? {
              id: post.communityProfile.community.id,
              name: post.communityProfile.community.name,
              slug: post.communityProfile.community.slug,
              imageUrl: post.communityProfile.community.imageUrl,
            }
          : null,
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async findPost(postId: number, userId: string, knownCommunity?: Community) {
    const post = await this.postRepository.findOne({
      where: { id: postId },
      relations: {
        communityProfile: { community: true },
        postTags: { tag: true },
        images: true,
      },
    });

    if (!post || !post.communityProfile?.community) {
      throw new NotFoundException('Publicación no encontrada');
    }

    const community = knownCommunity ?? post.communityProfile.community;
    if (!community.isActive) {
      throw new NotFoundException('Publicación no encontrada');
    }

    const profile = await this.communityProfileRepository.findOne({
      where: {
        userId,
        communityId: community.id,
      },
      select: { communityProfileId: true },
    });
    const metrics = await this.getPostMetrics(
      [post.id],
      profile?.communityProfileId,
      userId,
    );
    const replyCounts = await this.getReplyCounts([post.id]);
    const replies = await this.findReplies(post.id, userId);

    return {
      ...this.mapPost(
        post,
        metrics.get(post.id),
        replyCounts.get(post.id) ?? 0,
      ),
      replies,
    };
  }

  async createReply(postId: number, userId: string, dto: CreateReplyDto) {
    const post = await this.getActivePost(postId);
    const profile = await this.getMemberProfile(
      userId,
      post.communityProfile.communityId,
    );

    if (dto.parentReplyId !== undefined) {
      const parent = await this.replyRepository.findOne({
        where: { id: dto.parentReplyId, postId },
      });
      if (!parent) {
        throw new NotFoundException(
          'La respuesta padre no existe en esta publicación',
        );
      }
    }

    const reply = this.replyRepository.create({
      body: dto.body,
      postId,
      communityProfileId: profile.communityProfileId,
      parentReplyId: dto.parentReplyId ?? null,
    });
    const savedReply = await this.replyRepository.save(reply);
    return this.findReplyResponse(savedReply.id, userId);
  }

  async findReplies(postId: number, userId: string) {
    const post = await this.getActivePost(postId);
    const replies = await this.replyRepository.find({
      where: { postId },
      relations: { communityProfile: true },
      order: { postedAt: 'ASC', id: 'ASC' },
    });
    const profile = await this.communityProfileRepository.findOne({
      where: { userId, communityId: post.communityProfile.communityId },
      select: { communityProfileId: true },
    });
    const metrics = await this.getReplyMetrics(
      replies.map((reply) => reply.id),
      profile?.communityProfileId,
      userId,
    );

    return replies.map((reply) => ({
      id: reply.id,
      body: reply.body,
      postedAt: reply.postedAt,
      postId: reply.postId,
      communityProfileId: reply.communityProfileId,
      parentReplyId: reply.parentReplyId,
      author: reply.communityProfile
        ? {
            communityProfileId: reply.communityProfile.communityProfileId,
            displayName: reply.communityProfile.displayName,
            role: reply.communityProfile.role,
          }
        : null,
      ...(metrics.get(reply.id) ?? this.emptyMetric()),
    }));
  }

  async findReplyResponse(replyId: number, userId: string) {
    const reply = await this.replyRepository.findOne({
      where: { id: replyId },
      relations: { communityProfile: true, post: { communityProfile: true } },
    });
    if (!reply || !reply.post) {
      throw new NotFoundException('Respuesta no encontrada');
    }
    await this.getActiveCommunity(reply.post.communityProfile.communityId);
    const profile = await this.communityProfileRepository.findOne({
      where: {
        userId,
        communityId: reply.post.communityProfile.communityId,
      },
      select: { communityProfileId: true },
    });
    const metrics = await this.getReplyMetrics(
      [reply.id],
      profile?.communityProfileId,
      userId,
    );

    return {
      id: reply.id,
      body: reply.body,
      postedAt: reply.postedAt,
      postId: reply.postId,
      communityProfileId: reply.communityProfileId,
      parentReplyId: reply.parentReplyId,
      author: reply.communityProfile
        ? {
            communityProfileId: reply.communityProfile.communityProfileId,
            displayName: reply.communityProfile.displayName,
            role: reply.communityProfile.role,
          }
        : null,
      ...(metrics.get(reply.id) ?? this.emptyMetric()),
    };
  }

  async votePost(postId: number, userId: string, dto: VoteDto) {
    const post = await this.getActivePost(postId);
    const profile = await this.getMemberProfile(
      userId,
      post.communityProfile.communityId,
    );
    const existing = await this.postVoteRepository.findOne({
      where: { postId, communityProfileId: profile.communityProfileId },
    });

    if (existing && existing.voteType === dto.voteType) {
      await this.postVoteRepository.remove(existing);
    } else if (existing) {
      existing.voteType = dto.voteType;
      await this.postVoteRepository.save(existing);
    } else {
      await this.postVoteRepository.save(
        this.postVoteRepository.create({
          postId,
          communityProfileId: profile.communityProfileId,
          voteType: dto.voteType,
        }),
      );
    }

    return this.getPostMetricsResponse(
      postId,
      profile.communityProfileId,
      userId,
    );
  }

  async voteReply(replyId: number, userId: string, dto: VoteDto) {
    const reply = await this.getReplyWithPost(replyId);
    const profile = await this.getMemberProfile(
      userId,
      reply.post.communityProfile.communityId,
    );
    const existing = await this.replyVoteRepository.findOne({
      where: { replyId, communityProfileId: profile.communityProfileId },
    });

    if (existing && existing.voteType === dto.voteType) {
      await this.replyVoteRepository.remove(existing);
    } else if (existing) {
      existing.voteType = dto.voteType;
      await this.replyVoteRepository.save(existing);
    } else {
      await this.replyVoteRepository.save(
        this.replyVoteRepository.create({
          replyId,
          communityProfileId: profile.communityProfileId,
          voteType: dto.voteType,
        }),
      );
    }

    return this.getReplyMetricsResponse(
      replyId,
      profile.communityProfileId,
      userId,
    );
  }

  async saveFavorite(
    itemType: FavoriteItemType,
    itemId: number,
    userId: string,
  ) {
    await this.validateFavoriteTarget(itemType, itemId);
    const existing = await this.favoriteRepository.findOne({
      where: { userId, itemId, itemType },
    });
    if (!existing) {
      await this.favoriteRepository.save(
        this.favoriteRepository.create({ userId, itemId, itemType }),
      );
    }
    return { itemId, itemType, isSaved: true };
  }

  async removeFavorite(
    itemType: FavoriteItemType,
    itemId: number,
    userId: string,
  ) {
    await this.validateFavoriteTarget(itemType, itemId);
    await this.favoriteRepository.delete({ userId, itemId, itemType });
    return { itemId, itemType, isSaved: false };
  }

  private async getActiveCommunity(communityId: number): Promise<Community> {
    const community = await this.communityRepository.findOne({
      where: { id: communityId, isActive: true },
    });
    if (!community) {
      throw new NotFoundException('Comunidad no encontrada');
    }
    return community;
  }

  private async getMemberProfile(
    userId: string,
    communityId: number,
  ): Promise<CommunityProfile> {
    const profile = await this.communityProfileRepository.findOne({
      where: { userId, communityId },
    });
    if (!profile) {
      throw new ForbiddenException(
        'Debes pertenecer a la comunidad para realizar esta acción',
      );
    }
    return profile;
  }

  private async getActivePost(postId: number): Promise<Post> {
    const post = await this.postRepository.findOne({
      where: { id: postId },
      relations: { communityProfile: { community: true } },
    });
    if (!post || !post.communityProfile?.community?.isActive) {
      throw new NotFoundException('Publicación no encontrada');
    }
    return post;
  }

  private async getReplyWithPost(replyId: number): Promise<Reply> {
    const reply = await this.replyRepository.findOne({
      where: { id: replyId },
      relations: { post: { communityProfile: { community: true } } },
    });
    if (!reply || !reply.post?.communityProfile?.community?.isActive) {
      throw new NotFoundException('Respuesta no encontrada');
    }
    return reply;
  }

  private async getTags(tagIds: number[] | undefined): Promise<Tag[]> {
    if (!tagIds || tagIds.length === 0) return [];
    const tags = await this.tagRepository.find({
      where: { tagId: In(tagIds) },
    });
    const existingIds = new Set(tags.map((tag) => tag.tagId));
    const missing = tagIds.filter((tagId) => !existingIds.has(tagId));
    if (missing.length > 0) {
      throw new NotFoundException(
        `No existen los siguientes tags: ${missing.join(', ')}`,
      );
    }
    return tags;
  }

  private async getPostMetrics(
    postIds: number[],
    communityProfileId: number | undefined,
    userId: string,
    profileByPostId?: Map<number, number | undefined>,
  ): Promise<Map<number, PostMetric>> {
    const result = new Map<number, PostMetric>();
    if (postIds.length === 0) return result;

    const [votes, favorites] = await Promise.all([
      this.postVoteRepository.find({ where: { postId: In(postIds) } }),
      this.favoriteRepository.find({
        where: { itemId: In(postIds), itemType: FavoriteItemType.POST },
      }),
    ]);
    const favoriteIds = new Set(
      favorites
        .filter((favorite) => favorite.userId === userId)
        .map((favorite) => favorite.itemId),
    );

    for (const postId of postIds) {
      const postVotes = votes.filter((vote) => vote.postId === postId);
      const currentProfileId =
        profileByPostId?.get(postId) ?? communityProfileId;
      const myVote = postVotes.find(
        (vote) => vote.communityProfileId === currentProfileId,
      )?.voteType;
      result.set(postId, {
        upVotes: postVotes.filter((vote) => vote.voteType === VoteType.UP)
          .length,
        downVotes: postVotes.filter((vote) => vote.voteType === VoteType.DOWN)
          .length,
        timesSaved: favorites.filter((favorite) => favorite.itemId === postId)
          .length,
        myVote: myVote ?? null,
        isSaved: favoriteIds.has(postId),
      });
    }
    return result;
  }

  private async getReplyMetrics(
    replyIds: number[],
    communityProfileId: number | undefined,
    userId: string,
  ): Promise<Map<number, PostMetric>> {
    const result = new Map<number, PostMetric>();
    if (replyIds.length === 0) return result;
    const [votes, favorites] = await Promise.all([
      this.replyVoteRepository.find({ where: { replyId: In(replyIds) } }),
      this.favoriteRepository.find({
        where: { itemId: In(replyIds), itemType: FavoriteItemType.REPLY },
      }),
    ]);
    for (const replyId of replyIds) {
      const replyVotes = votes.filter((vote) => vote.replyId === replyId);
      result.set(replyId, {
        upVotes: replyVotes.filter((vote) => vote.voteType === VoteType.UP)
          .length,
        downVotes: replyVotes.filter((vote) => vote.voteType === VoteType.DOWN)
          .length,
        timesSaved: favorites.filter((favorite) => favorite.itemId === replyId)
          .length,
        myVote:
          replyVotes.find(
            (vote) => vote.communityProfileId === communityProfileId,
          )?.voteType ?? null,
        isSaved: favorites.some(
          (favorite) =>
            favorite.itemId === replyId && favorite.userId === userId,
        ),
      });
    }
    return result;
  }

  private async getReplyCounts(
    postIds: number[],
  ): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    if (postIds.length === 0) return counts;
    const rows = (await this.replyRepository
      .createQueryBuilder('reply')
      .select('reply.post_id', 'post_id')
      .addSelect('COUNT(reply.id)', 'count')
      .where('reply.post_id IN (:...postIds)', { postIds })
      .groupBy('reply.post_id')
      .getRawMany()) as unknown as { post_id: string; count: string }[];
    rows.forEach((row) => counts.set(Number(row.post_id), Number(row.count)));
    return counts;
  }

  private async getPostMetricsResponse(
    postId: number,
    communityProfileId: number,
    userId: string,
  ) {
    const metrics = await this.getPostMetrics(
      [postId],
      communityProfileId,
      userId,
    );
    return { postId, ...(metrics.get(postId) ?? this.emptyMetric()) };
  }

  private async getReplyMetricsResponse(
    replyId: number,
    communityProfileId: number,
    userId: string,
  ) {
    const metrics = await this.getReplyMetrics(
      [replyId],
      communityProfileId,
      userId,
    );
    return { replyId, ...(metrics.get(replyId) ?? this.emptyMetric()) };
  }

  private async validateFavoriteTarget(
    itemType: FavoriteItemType,
    itemId: number,
  ): Promise<void> {
    if (itemType === FavoriteItemType.POST) {
      await this.getActivePost(itemId);
      return;
    }
    if (itemType === FavoriteItemType.REPLY) {
      await this.getReplyWithPost(itemId);
      return;
    }
    const product = await this.productRepository.findOne({
      where: { id: itemId, status: ProductStatus.ACTIVE },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
  }

  private mapPost(
    post: Post,
    metric: PostMetric | undefined,
    replyCount: number,
  ) {
    const postMetric = metric ?? this.emptyMetric();
    return {
      id: post.id,
      title: post.title,
      body: post.body,
      postedAt: post.postedAt,
      communityProfileId: post.communityProfileId,
      author: post.communityProfile
        ? {
            communityProfileId: post.communityProfile.communityProfileId,
            displayName: post.communityProfile.displayName,
            role: post.communityProfile.role,
          }
        : null,
      tags: (post.postTags ?? []).map(({ tag }) => ({
        tagId: tag.tagId,
        name: tag.name,
      })),
      images: [...(post.images ?? [])]
        .sort((left, right) => left.order - right.order)
        .map(({ id, url, order }) => ({ id, url, order })),
      ...postMetric,
      replyCount,
    };
  }

  private emptyMetric(): PostMetric {
    return {
      upVotes: 0,
      downVotes: 0,
      timesSaved: 0,
      myVote: null,
      isSaved: false,
    };
  }

  // Posts publicados por el usuario autenticado (todas sus comunidades
  // activas), ordenables por fecha, upvotes, downvotes o veces guardado.
  async findMyPosts(userId: string, query: GetMyPostsQueryDto) {
    const direction = query.order === SortOrder.ASC ? 'ASC' : 'DESC';
    const sortExpressions: Record<MyPostsSortBy, string> = {
      [MyPostsSortBy.DATE]: 'post.posted_at',
      [MyPostsSortBy.UPVOTES]: `(SELECT COUNT(*) FROM post_vote sort_vote WHERE sort_vote.post_id = post.id AND sort_vote."voteType" = 'UP')`,
      [MyPostsSortBy.DOWNVOTES]: `(SELECT COUNT(*) FROM post_vote sort_vote WHERE sort_vote.post_id = post.id AND sort_vote."voteType" = 'DOWN')`,
      [MyPostsSortBy.SAVES]: `(SELECT COUNT(*) FROM favorite sort_favorite WHERE sort_favorite.item_id = post.id AND sort_favorite."itemType" = 'POST')`,
    };

    const base = this.postRepository
      .createQueryBuilder('post')
      .innerJoin('post.communityProfile', 'profile')
      .innerJoin('profile.community', 'community')
      .where('profile.user_id = :userId', { userId })
      .andWhere('community.is_active = :isActive', { isActive: true });

    const total = await base.clone().getCount();
    const rows = await base
      .select('post.id', 'id')
      .orderBy(sortExpressions[query.sortBy], direction)
      .addOrderBy('post.posted_at', 'DESC')
      .addOrderBy('post.id', 'DESC')
      .offset((query.page - 1) * query.limit)
      .limit(query.limit)
      .getRawMany<{ id: number }>();

    const cards = await this.buildPostCards(
      rows.map((row) => Number(row.id)),
      userId,
    );

    return {
      data: cards,
      pagination: this.buildPageInfo(query.page, query.limit, total),
    };
  }

  // Posts y productos publicados por el usuario, mezclados por fecha.
  async findMyContent(userId: string, query: GetMyFeedQueryDto) {
    const entries: ContentEntry[] = [];

    {
      const posts = await this.postRepository.find({
        where: {
          communityProfile: { userId, community: { isActive: true } },
        },
        select: { id: true, postedAt: true },
      });
      posts.forEach((post) =>
        entries.push({ type: 'post', id: post.id, date: post.postedAt }),
      );
    }

    {
      const products = await this.productRepository.find({
        where: { seller: { userId } },
        select: { id: true, createdAt: true },
      });
      products.forEach((product) =>
        entries.push({
          type: 'product',
          id: product.id,
          date: product.createdAt,
        }),
      );
    }

    return this.pageContent(entries, userId, query);
  }

  // Posts y productos guardados como favoritos por el usuario; la fecha es
  // la de guardado. Se omiten los que ya no existen o no están disponibles.
  async findMyFavorites(userId: string, query: GetMyContentQueryDto) {
    const itemTypes = [
      ...(query.type !== ContentType.PRODUCTS ? [FavoriteItemType.POST] : []),
      ...(query.type !== ContentType.POSTS ? [FavoriteItemType.PRODUCT] : []),
    ];
    const favorites = await this.favoriteRepository.find({
      where: { userId, itemType: In(itemTypes) },
    });

    const postIds = favorites
      .filter((favorite) => favorite.itemType === FavoriteItemType.POST)
      .map((favorite) => favorite.itemId);
    const productIds = favorites
      .filter((favorite) => favorite.itemType === FavoriteItemType.PRODUCT)
      .map((favorite) => favorite.itemId);

    const [visiblePosts, visibleProducts] = await Promise.all([
      postIds.length
        ? this.postRepository.find({
            where: {
              id: In(postIds),
              communityProfile: { community: { isActive: true } },
            },
            select: { id: true },
          })
        : ([] as Post[]),
      productIds.length
        ? this.productRepository.find({
            where: {
              id: In(productIds),
              status: In([ProductStatus.ACTIVE, ProductStatus.SOLD]),
            },
            select: { id: true },
          })
        : ([] as Product[]),
    ]);
    const visiblePostIds = new Set(visiblePosts.map((post) => post.id));
    const visibleProductIds = new Set(visibleProducts.map((p) => p.id));

    const entries: ContentEntry[] = [];
    for (const favorite of favorites) {
      if (favorite.itemType === FavoriteItemType.POST) {
        if (visiblePostIds.has(favorite.itemId)) {
          entries.push({
            type: 'post',
            id: favorite.itemId,
            date: favorite.createdAt,
          });
        }
      } else if (visibleProductIds.has(favorite.itemId)) {
        entries.push({
          type: 'product',
          id: favorite.itemId,
          date: favorite.createdAt,
        });
      }
    }

    return this.pageContent(entries, userId, query);
  }

  private async pageContent(
    entries: ContentEntry[],
    userId: string,
    query: GetMyFeedQueryDto,
  ) {
    const sign = query.order === SortOrder.ASC ? 1 : -1;
    entries.sort(
      (a, b) =>
        sign * (a.date.getTime() - b.date.getTime()) || sign * (a.id - b.id),
    );

    const pageEntries = entries.slice(
      (query.page - 1) * query.limit,
      query.page * query.limit,
    );
    const [postCards, productCards] = await Promise.all([
      this.buildPostCards(
        pageEntries.filter((e) => e.type === 'post').map((e) => e.id),
        userId,
      ),
      this.buildProductCards(
        pageEntries.filter((e) => e.type === 'product').map((e) => e.id),
        userId,
      ),
    ]);
    const postById = new Map(postCards.map((card) => [card.id, card]));
    const productById = new Map(productCards.map((card) => [card.id, card]));

    const data = pageEntries.map((entry) =>
      entry.type === 'post'
        ? {
            type: 'post' as const,
            date: entry.date,
            post: postById.get(entry.id)!,
          }
        : {
            type: 'product' as const,
            date: entry.date,
            product: productById.get(entry.id)!,
          },
    );

    return {
      data,
      pagination: this.buildPageInfo(query.page, query.limit, entries.length),
    };
  }

  private buildPageInfo(page: number, limit: number, total: number) {
    return { page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  // Hidrata posts por id respetando el orden recibido, con métricas y
  // estado del usuario (myVote / isSaved) como en el feed global.
  private async buildPostCards(postIds: number[], userId: string) {
    if (postIds.length === 0) return [];

    const posts = await this.postRepository.find({
      where: { id: In(postIds) },
      relations: {
        communityProfile: { community: true },
        postTags: { tag: true },
        images: true,
      },
    });
    const postById = new Map(posts.map((post) => [post.id, post]));
    const ordered = postIds
      .map((id) => postById.get(id))
      .filter((post): post is Post => post !== undefined);

    const communityIds = [
      ...new Set(ordered.map((post) => post.communityProfile.communityId)),
    ];
    const profiles = communityIds.length
      ? await this.communityProfileRepository.find({
          where: { userId, communityId: In(communityIds) },
          select: { communityProfileId: true, communityId: true },
        })
      : [];
    const profileByCommunityId = new Map(
      profiles.map((profile) => [
        profile.communityId,
        profile.communityProfileId,
      ]),
    );
    const profileByPostId = new Map(
      ordered.map((post) => [
        post.id,
        profileByCommunityId.get(post.communityProfile.communityId),
      ]),
    );
    const metrics = await this.getPostMetrics(
      ordered.map((post) => post.id),
      undefined,
      userId,
      profileByPostId,
    );
    const replyCounts = await this.getReplyCounts(ordered.map((p) => p.id));

    return ordered.map((post) => ({
      ...this.mapPost(
        post,
        metrics.get(post.id),
        replyCounts.get(post.id) ?? 0,
      ),
      community: {
        id: post.communityProfile.community.id,
        name: post.communityProfile.community.name,
        slug: post.communityProfile.community.slug,
        imageUrl: post.communityProfile.community.imageUrl,
      },
    }));
  }

  private async buildProductCards(productIds: number[], userId: string) {
    if (productIds.length === 0) return [];

    const [products, favorites] = await Promise.all([
      this.productRepository.find({
        where: { id: In(productIds) },
        relations: {
          productTags: { tag: true },
          community: true,
          seller: { user: true },
        },
      }),
      this.favoriteRepository.find({
        where: {
          userId,
          itemType: FavoriteItemType.PRODUCT,
          itemId: In(productIds),
        },
      }),
    ]);
    const savedIds = new Set(favorites.map((favorite) => favorite.itemId));
    const productById = new Map(products.map((p) => [p.id, p]));

    return productIds
      .map((id) => productById.get(id))
      .filter((product): product is Product => product !== undefined)
      .map((product) => ({
        id: product.id,
        title: product.title,
        price: product.price,
        currency: product.currency,
        imageUrl: product.imageUrl,
        status: product.status,
        type: product.type,
        condition: product.condition,
        tags: product.productTags.map(({ tag }) => ({
          tagId: tag.tagId,
          name: tag.name,
        })),
        community: { id: product.community.id, name: product.community.name },
        seller: {
          sellerId: product.seller.sellerId,
          displayName: product.seller.displayName,
          photoUrl: product.seller.user.photoUrl ?? null,
          isVerified: product.seller.isVerified,
        },
        isSaved: savedIds.has(product.id),
      }));
  }
}
