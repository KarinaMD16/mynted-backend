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

  it('includes the author photo in posts listed by community', async () => {
    const ctx = setup();
    const post = {
      id: 11,
      title: 'Community post',
      body: 'Body',
      postedAt: new Date(),
      communityProfileId: 4,
      communityProfile: {
        communityProfileId: 4,
        displayName: 'Author',
        role: 'member',
        user: { photoUrl: 'https://img.test/author.png' },
      },
      postTags: [],
      images: [],
    } as unknown as Post;
    ctx.communityRepository.findOne.mockResolvedValue({
      id: 7,
      isActive: true,
    });
    ctx.profileRepository.findOne.mockResolvedValue({
      communityProfileId: 4,
    });
    ctx.postRepository.findAndCount.mockResolvedValue([[post], 1]);

    const result = await ctx.service.findPosts(7, 'user-id', {
      page: 1,
      limit: 10,
    });

    expect(result.data[0].author).toMatchObject({
      communityProfileId: 4,
      displayName: 'Author',
      role: 'member',
      photoUrl: 'https://img.test/author.png',
    });
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

  it('recommends posts by UserTag and returns matchedTagCount', async () => {
    const ctx = setup();
    const postBuilder = ctx.postRepository.createQueryBuilder();
    const postTagBuilder = ctx.postTagRepository.createQueryBuilder();
    ctx.postRepository.createQueryBuilder.mockReturnValue(postBuilder);
    ctx.postTagRepository.createQueryBuilder.mockReturnValue(postTagBuilder);
    ctx.userTagRepository.find.mockResolvedValue([{ tagId: 1 }, { tagId: 3 }]);
    const post = {
      id: 12,
      title: 'Recommended post',
      body: 'Body',
      postedAt: new Date(),
      communityProfileId: 4,
      communityProfile: {
        communityProfileId: 4,
        communityId: 7,
        displayName: 'Author',
        role: 'member',
        user: { photoUrl: null },
        community: {
          id: 7,
          name: 'Public community',
          slug: 'public-community',
          imageUrl: null,
          isActive: true,
          isPrivate: false,
        },
      },
      postTags: [],
      images: [],
    } as unknown as Post;
    const lowerMatchPost = {
      ...post,
      id: 13,
      title: 'Lower match post',
    };
    postBuilder.getManyAndCount.mockResolvedValue([[post, lowerMatchPost], 2]);
    postTagBuilder.getRawMany.mockResolvedValue([
      { post_id: '12', count: '2' },
      { post_id: '13', count: '1' },
    ]);
    ctx.profileRepository.find.mockResolvedValue([]);

    const result = await ctx.service.findRecommendedPosts('user-id', {
      page: 1,
      limit: 10,
    });

    expect(ctx.userTagRepository.find).toHaveBeenCalledWith({
      where: { userId: 'user-id' },
      select: { tagId: true },
    });
    expect(postBuilder.orderBy).toHaveBeenCalledWith(
      'matched_tag_count',
      'DESC',
    );
    expect(result.data[0]).toMatchObject({
      id: 12,
      matchedTagCount: 2,
      community: { id: 7 },
    });
    expect(result.data[1]).toMatchObject({
      id: 13,
      matchedTagCount: 1,
    });
    expect(typeof result.data[0].matchedTagCount).toBe('number');
  });

  it('returns an empty paginated result when the user has no interests', async () => {
    const ctx = setup();
    ctx.userTagRepository.find.mockResolvedValue([]);

    const result = await ctx.service.findRecommendedPosts('user-id', {
      page: 2,
      limit: 10,
    });

    expect(result).toEqual({
      data: [],
      pagination: { page: 2, limit: 10, total: 0, totalPages: 0 },
    });
    expect(ctx.postRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('lists the global feed with public-community and tag filters', async () => {
    const ctx = setup();
    const builder = ctx.postRepository.createQueryBuilder();
    ctx.postRepository.createQueryBuilder.mockReturnValue(builder);
    const post = {
      id: 10,
      title: 'Global post',
      body: 'Body',
      postedAt: new Date(),
      communityProfileId: 4,
      communityProfile: {
        communityProfileId: 4,
        communityId: 7,
        displayName: 'Author',
        role: 'member',
        user: { photoUrl: 'https://img.test/author.png' },
        community: {
          id: 7,
          name: 'Public community',
          slug: 'public-community',
          imageUrl: null,
          isActive: true,
          isPrivate: false,
        },
      },
      postTags: [],
      images: [],
    } as unknown as Post;
    builder.getManyAndCount.mockResolvedValue([[post], 1]);
    ctx.profileRepository.find.mockResolvedValue([
      { communityProfileId: 4, communityId: 7 },
    ]);

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
    expect(builder.distinct).toHaveBeenCalledWith(true);
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

  it('lists the global feed without requiring tagIds', async () => {
    const ctx = setup();
    const builder = ctx.postRepository.createQueryBuilder();
    ctx.postRepository.createQueryBuilder.mockReturnValue(builder);
    builder.getManyAndCount.mockResolvedValue([[], 0]);

    const result = await ctx.service.findGlobalPosts('user-id', {
      page: 1,
      limit: 10,
    });

    expect(builder.andWhere).toHaveBeenCalledWith(
      'community.is_private = :isPrivate',
      { isPrivate: false },
    );
    expect(builder.andWhere).not.toHaveBeenCalledWith(
      expect.stringContaining('global_feed_filter_post_tag'),
      expect.anything(),
    );
    expect(result).toEqual({
      data: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
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
