import { Repository } from 'typeorm';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { Product } from '../products/entities/product.entity';
import { CommunityProfile } from './entities/community-profile.entity';
import { Community } from './entities/community.entity';
import { Favorite } from './entities/favorite.entity';
import { PostImage } from './entities/post-image.entity';
import { PostTag } from './entities/post-tag.entity';
import { PostVote } from './entities/post-vote.entity';
import { Post } from './entities/post.entity';
import { Reply } from './entities/reply.entity';
import { ReplyVote } from './entities/reply-vote.entity';
import { Tag } from './entities/tag.entity';
import { ForumService } from './forum.service';
import { VoteType } from './entities/vote-type.enum';
import { UserTag } from '../user-tags/entities/user-tag.entity';
import { PostSort } from './post-ranking';

/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */

describe('ForumService', () => {
  const repository = () => ({
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    save: jest.fn(),
    remove: jest.fn(),
    delete: jest.fn(),
    create: jest.fn((_, value) => value),
    createQueryBuilder: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      setParameter: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      clone: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    })),
  });

  const setup = () => {
    const communityRepository = repository();
    const profileRepository = repository();
    const postRepository = repository();
    const postTagRepository = repository();
    const postImageRepository = repository();
    const tagRepository = repository();
    const replyRepository = repository();
    const postVoteRepository = repository();
    const replyVoteRepository = repository();
    const favoriteRepository = repository();
    const productRepository = repository();
    const userTagRepository = repository();
    const manager = {
      create: jest.fn((_, value) => value),
      save: jest.fn((_, value) => ({ id: 10, ...value })),
    };
    const dataSource = {
      transaction: jest.fn((callback) => callback(manager)),
    };
    const cloudinary = { uploadImages: jest.fn().mockResolvedValue([]) };
    const service = new ForumService(
      communityRepository as unknown as Repository<Community>,
      profileRepository as unknown as Repository<CommunityProfile>,
      postRepository as unknown as Repository<Post>,
      postTagRepository as unknown as Repository<PostTag>,
      postImageRepository as unknown as Repository<PostImage>,
      tagRepository as unknown as Repository<Tag>,
      replyRepository as unknown as Repository<Reply>,
      postVoteRepository as unknown as Repository<PostVote>,
      replyVoteRepository as unknown as Repository<ReplyVote>,
      favoriteRepository as unknown as Repository<Favorite>,
      productRepository as unknown as Repository<Product>,
      dataSource as never,
      cloudinary as unknown as CloudinaryService,
      userTagRepository as unknown as Repository<UserTag>,
    );
    return {
      service,
      communityRepository,
      profileRepository,
      postRepository,
      postTagRepository,
      tagRepository,
      replyRepository,
      userTagRepository,
      postVoteRepository,
      manager,
    };
  };

  it('creates a post for an active community member', async () => {
    const ctx = setup();
    ctx.communityRepository.findOne.mockResolvedValue({
      id: 7,
      isActive: true,
    });
    ctx.profileRepository.findOne
      .mockResolvedValueOnce({ communityProfileId: 4, communityId: 7 })
      .mockResolvedValueOnce({ communityProfileId: 4, communityId: 7 });
    ctx.tagRepository.find.mockResolvedValue([{ tagId: 1 }]);
    ctx.postRepository.findOne.mockResolvedValue({
      id: 10,
      communityProfile: { community: { id: 7, isActive: true } },
    });
    ctx.postRepository.findOne.mockResolvedValueOnce({
      id: 10,
      communityProfile: { community: { id: 7, isActive: true } },
      postTags: [],
      images: [],
    });

    await ctx.service.createPost(
      7,
      'user-id',
      {
        title: 'Title',
        body: 'Body',
        tagIds: [1],
      },
      {},
    );

    expect(ctx.manager.save).toHaveBeenCalledWith(
      Post,
      expect.objectContaining({
        title: 'Title',
        body: 'Body',
        communityProfileId: 4,
      }),
    );
  });

  it('rejects post creation when the community is inactive', async () => {
    const ctx = setup();
    ctx.communityRepository.findOne.mockResolvedValue(null);

    await expect(
      ctx.service.createPost(
        7,
        'user-id',
        { title: 'Title', body: 'Body' },
        {},
      ),
    ).rejects.toThrow('Comunidad no encontrada');
  });

  it('rejects post creation when a tag does not exist', async () => {
    const ctx = setup();
    ctx.communityRepository.findOne.mockResolvedValue({
      id: 7,
      isActive: true,
    });
    ctx.profileRepository.findOne.mockResolvedValue({
      communityProfileId: 4,
      communityId: 7,
    });
    ctx.tagRepository.find.mockResolvedValue([]);

    await expect(
      ctx.service.createPost(
        7,
        'user-id',
        { title: 'Title', body: 'Body', tagIds: [999] },
        {},
      ),
    ).rejects.toThrow('No existen los siguientes tags: 999');
  });

  it('toggles a post vote off when the same vote is sent twice', async () => {
    const ctx = setup();
    ctx.postRepository.findOne.mockResolvedValue({
      id: 10,
      communityProfile: { communityId: 7, community: { isActive: true } },
    });
    ctx.profileRepository.findOne.mockResolvedValue({ communityProfileId: 4 });
    ctx.postVoteRepository.findOne.mockResolvedValue({
      postId: 10,
      communityProfileId: 4,
      voteType: VoteType.UP,
    });
    ctx.postVoteRepository.find.mockResolvedValue([]);
    await ctx.service.votePost(10, 'user-id', { voteType: VoteType.UP });

    expect(ctx.postVoteRepository.remove).toHaveBeenCalled();
  });

  const feedPost = (id: number, communityId = 7) =>
    ({
      id,
      title: `Post ${id}`,
      body: 'Body',
      postedAt: new Date(),
      communityProfileId: 4,
      communityProfile: {
        communityProfileId: 4,
        communityId,
        displayName: 'Author',
        role: 'member',
        user: { photoUrl: 'https://img.test/author.png' },
        community: {
          id: communityId,
          name: 'Public community',
          slug: 'public-community',
          imageUrl: null,
          isActive: true,
          isPrivate: false,
        },
      },
      postTags: [],
      images: [],
    }) as unknown as Post;

  const rankedBuilder = (
    ctx: ReturnType<typeof setup>,
    ids: number[],
    total = ids.length,
  ) => {
    const builder = ctx.postRepository.createQueryBuilder();
    ctx.postRepository.createQueryBuilder.mockReturnValue(builder);
    builder.getCount.mockResolvedValue(total);
    builder.getRawMany.mockResolvedValue(ids.map((id) => ({ id })));
    ctx.postRepository.find.mockResolvedValue(ids.map((id) => feedPost(id)));
    return builder;
  };

  it('lists community posts ranked by votes and freshness with the author photo', async () => {
    const ctx = setup();
    ctx.communityRepository.findOne.mockResolvedValue({
      id: 7,
      isActive: true,
      isPrivate: false,
    });
    const builder = rankedBuilder(ctx, [11, 12]);

    const result = await ctx.service.findPosts(7, 'user-id', {
      page: 1,
      limit: 10,
    });

    expect(builder.andWhere).toHaveBeenCalledWith(
      'community.id = :communityId',
      { communityId: 7 },
    );
    expect(builder.addSelect).toHaveBeenCalledWith(
      expect.stringContaining('post_vote'),
      'rank_score',
    );
    expect(builder.orderBy).toHaveBeenCalledWith('rank_score', 'DESC');
    expect(result.data.map((post) => post.id)).toEqual([11, 12]);
    expect(result.data[0].author).toMatchObject({
      communityProfileId: 4,
      displayName: 'Author',
      role: 'member',
      photoUrl: 'https://img.test/author.png',
    });
    expect(result.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
    });
  });

  it('orders community posts chronologically with sort=new', async () => {
    const ctx = setup();
    ctx.communityRepository.findOne.mockResolvedValue({
      id: 7,
      isActive: true,
      isPrivate: false,
    });
    const builder = rankedBuilder(ctx, [11]);

    await ctx.service.findPosts(7, 'user-id', {
      page: 1,
      limit: 10,
      sort: PostSort.NEW,
    });

    expect(builder.addSelect).toHaveBeenCalledWith(
      expect.not.stringContaining('post_vote'),
      'rank_score',
    );
  });
  it('rejects a non-member from posts in a private community', async () => {
    const ctx = setup();
    ctx.communityRepository.findOne.mockResolvedValue({
      id: 7,
      isActive: true,
      isPrivate: true,
    });
    ctx.profileRepository.findOne.mockResolvedValue(null);

    await expect(
      ctx.service.findPosts(7, 'user-id', { page: 1, limit: 10 }),
    ).rejects.toThrow('Debes pertenecer a la comunidad');
    expect(ctx.postRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('includes null author photos in replies', async () => {
    const ctx = setup();
    ctx.postRepository.findOne.mockResolvedValue({
      id: 10,
      communityProfile: {
        communityId: 7,
        community: { isActive: true },
      },
    });
    ctx.replyRepository.find.mockResolvedValue([
      {
        id: 20,
        body: 'Reply',
        postId: 10,
        communityProfileId: 4,
        parentReplyId: null,
        communityProfile: {
          communityProfileId: 4,
          displayName: 'Reply author',
          role: 'member',
          user: { photoUrl: null },
        },
      },
    ]);
    ctx.profileRepository.findOne.mockResolvedValue(null);

    const replies = await ctx.service.findReplies(10, 'user-id');

    expect(replies[0].author).toMatchObject({
      communityProfileId: 4,
      displayName: 'Reply author',
      role: 'member',
      photoUrl: null,
    });
  });

  it('rejects a non-member from replies in a private community', async () => {
    const ctx = setup();
    ctx.postRepository.findOne.mockResolvedValue({
      id: 10,
      communityProfile: {
        communityId: 7,
        community: { isActive: true, isPrivate: true },
      },
    });
    ctx.profileRepository.findOne.mockResolvedValue(null);

    await expect(ctx.service.findReplies(10, 'user-id')).rejects.toThrow(
      'Debes pertenecer a la comunidad',
    );
    expect(ctx.replyRepository.find).not.toHaveBeenCalled();
  });

  it('includes photos in post detail and embedded replies', async () => {
    const ctx = setup();
    const post = {
      id: 10,
      title: 'Post detail',
      body: 'Body',
      postedAt: new Date(),
      communityProfileId: 4,
      communityProfile: {
        communityProfileId: 4,
        communityId: 7,
        displayName: 'Post author',
        role: 'member',
        user: { photoUrl: 'https://img.test/post-author.png' },
        community: { id: 7, isActive: true },
      },
      postTags: [],
      images: [],
    } as unknown as Post;
    ctx.postRepository.findOne.mockResolvedValue(post);
    ctx.profileRepository.findOne.mockResolvedValue(null);
    ctx.replyRepository.find.mockResolvedValue([
      {
        id: 21,
        body: 'Nested reply',
        postId: 10,
        communityProfileId: 5,
        parentReplyId: null,
        communityProfile: {
          communityProfileId: 5,
          displayName: 'Reply author',
          role: 'member',
          user: { photoUrl: 'https://img.test/reply-author.png' },
        },
      },
    ]);

    const result = await ctx.service.findPost(10, 'user-id');

    expect(result.author).toMatchObject({
      displayName: 'Post author',
      photoUrl: 'https://img.test/post-author.png',
    });
    expect(result.replies[0].author).toMatchObject({
      displayName: 'Reply author',
      photoUrl: 'https://img.test/reply-author.png',
    });
  });

  it('rejects a non-member from a private post before loading its replies', async () => {
    const ctx = setup();
    ctx.postRepository.findOne.mockResolvedValue({
      id: 10,
      communityProfile: {
        communityId: 7,
        community: { id: 7, isActive: true, isPrivate: true },
      },
    });
    ctx.profileRepository.findOne.mockResolvedValue(null);

    await expect(ctx.service.findPost(10, 'user-id')).rejects.toThrow(
      'Debes pertenecer a la comunidad',
    );
    expect(ctx.replyRepository.find).not.toHaveBeenCalled();
  });

  it('ranks explore by interests, votes and discovery for an authenticated user', async () => {
    const ctx = setup();
    const builder = rankedBuilder(ctx, [12, 13]);
    const postTagBuilder = ctx.postTagRepository.createQueryBuilder();
    ctx.postTagRepository.createQueryBuilder.mockReturnValue(postTagBuilder);
    postTagBuilder.getRawMany.mockResolvedValue([
      { post_id: '12', count: '2' },
      { post_id: '13', count: '1' },
    ]);
    ctx.userTagRepository.find.mockResolvedValue([{ tagId: 1 }, { tagId: 3 }]);
    ctx.profileRepository.find.mockResolvedValue([{ communityId: 9 }]);

    const result = await ctx.service.findRecommendedPosts('user-id', {
      page: 1,
      limit: 10,
    });

    expect(builder.andWhere).toHaveBeenCalledWith(
      'community.is_private = :isPrivate',
      { isPrivate: false },
    );
    expect(builder.setParameters).toHaveBeenCalledWith(
      expect.objectContaining({ userTagIds: [1, 3], joinedIds: [9] }),
    );
    expect(builder.addSelect).toHaveBeenCalledWith(
      expect.stringContaining('POWER'),
      'rank_score',
    );
    expect(result.meta).toEqual({ personalized: true });
    expect(result.data[0]).toMatchObject({
      id: 12,
      matchedTagCount: 2,
      community: { id: 7 },
    });
    expect(result.data[1]).toMatchObject({ id: 13, matchedTagCount: 1 });
  });

  it('ranks explore by popularity alone without a session', async () => {
    const ctx = setup();
    const builder = rankedBuilder(ctx, [12]);

    const result = await ctx.service.findRecommendedPosts(undefined, {
      page: 1,
      limit: 10,
    });

    expect(ctx.userTagRepository.find).not.toHaveBeenCalled();
    expect(builder.setParameters).toHaveBeenCalledWith(
      expect.objectContaining({ userTagIds: [], joinedIds: [] }),
    );
    expect(result.meta).toEqual({ personalized: false });
    expect(result.data[0]).toMatchObject({ id: 12, matchedTagCount: 0 });
  });

  it('lists the global feed without a session or tagIds', async () => {
    const ctx = setup();
    const builder = rankedBuilder(ctx, [], 0);

    const result = await ctx.service.findGlobalPosts(undefined, {
      page: 1,
      limit: 10,
    });

    expect(builder.andWhere).toHaveBeenCalledTimes(1);
    expect(builder.andWhere).toHaveBeenCalledWith(
      'community.is_private = :isPrivate',
      { isPrivate: false },
    );
    expect(result).toEqual({
      data: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
  });

  it('shows the home feed from the communities the user belongs to', async () => {
    const ctx = setup();
    const builder = rankedBuilder(ctx, [21, 22]);
    ctx.profileRepository.find.mockResolvedValue([
      { communityId: 3 },
      { communityId: 7 },
    ]);

    const result = await ctx.service.findHomePosts('user-id', {
      page: 1,
      limit: 10,
      sort: PostSort.HOT,
    });

    expect(builder.andWhere).toHaveBeenCalledWith(
      'community.id = ANY(CAST(:joinedIds AS int[]))',
      { joinedIds: [3, 7] },
    );
    expect(result.meta).toEqual({ source: 'joined' });
    expect(result.data.map((post) => post.id)).toEqual([21, 22]);
  });

  it('falls back to public communities in home without a session or memberships', async () => {
    const ctx = setup();
    const builder = rankedBuilder(ctx, [31]);

    const anonymous = await ctx.service.findHomePosts(undefined, {
      page: 1,
      limit: 10,
      sort: PostSort.HOT,
    });

    expect(ctx.profileRepository.find).not.toHaveBeenCalled();
    expect(builder.andWhere).toHaveBeenCalledWith(
      'community.is_private = :isPrivate',
      { isPrivate: false },
    );
    expect(anonymous.meta).toEqual({ source: 'public' });

    // Con sesión pero sin posts en sus comunidades también cae a público.
    ctx.profileRepository.find.mockResolvedValue([{ communityId: 3 }]);
    builder.getCount.mockResolvedValueOnce(0).mockResolvedValue(1);
    const empty = await ctx.service.findHomePosts('user-id', {
      page: 1,
      limit: 10,
      sort: PostSort.HOT,
    });
    expect(empty.meta).toEqual({ source: 'public' });
  });
  it('lists the global feed with public-community and tag filters', async () => {
    const ctx = setup();
    const builder = rankedBuilder(ctx, [10]);

    const result = await ctx.service.findGlobalPosts('user-id', {
      page: 1,
      limit: 20,
      tagIds: [1, 3],
      search: '  pokemon  ',
    });

    expect(builder.where).toHaveBeenCalledWith(
      'community.is_active = :isActive',
      { isActive: true },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'community.is_private = :isPrivate',
      { isPrivate: false },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('global_feed_filter_post_tag.tag_id IN'),
      { tagIds: [1, 3] },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      '(post.title ILIKE :search OR post.body ILIKE :search)',
      { search: '%pokemon%' },
    );
    expect(result).toMatchObject({
      data: [
        {
          id: 10,
          community: { id: 7, slug: 'public-community' },
          author: { photoUrl: 'https://img.test/author.png' },
          replyCount: 0,
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    expect(result.data[0]).not.toHaveProperty('matchedTagCount');
  });
  it('does not add a text filter when search only contains spaces', async () => {
    const ctx = setup();
    const builder = ctx.postRepository.createQueryBuilder();
    ctx.postRepository.createQueryBuilder.mockReturnValue(builder);

    await ctx.service.findGlobalPosts('user-id', {
      page: 1,
      limit: 20,
      search: '   ',
    });

    expect(builder.andWhere).toHaveBeenCalledTimes(1);
    expect(builder.andWhere).toHaveBeenCalledWith(
      'community.is_private = :isPrivate',
      { isPrivate: false },
    );
  });
});
