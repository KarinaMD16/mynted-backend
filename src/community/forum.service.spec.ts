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

/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */

describe('ForumService', () => {
  const repository = () => ({
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn(),
    remove: jest.fn(),
    delete: jest.fn(),
    create: jest.fn((_, value) => value),
    createQueryBuilder: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
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
    );
    return {
      service,
      communityRepository,
      profileRepository,
      postRepository,
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
});
