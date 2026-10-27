import { NotFoundException } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { ModerationItemType } from './enums/moderation-item-type.enum';

describe('ModerationService', () => {
  const postRepository = { findOne: jest.fn(), save: jest.fn() };
  const replyRepository = { findOne: jest.fn(), save: jest.fn() };
  const productRepository = { findOne: jest.fn(), save: jest.fn() };
  const notificationsService = { notify: jest.fn() };
  let service: ModerationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ModerationService(
      postRepository as never,
      replyRepository as never,
      productRepository as never,
      notificationsService as never,
    );
  });

  it('hides a post and normalizes a blank reason', async () => {
    const post = {
      id: 4,
      isHidden: false,
      hiddenAt: null,
      hiddenByUserId: null,
      hiddenReason: null,
      communityProfile: { communityId: 8 },
    };
    postRepository.findOne.mockResolvedValue(post);
    postRepository.save.mockImplementation((value: unknown) =>
      Promise.resolve(value),
    );

    const result = await service.hideContent(
      ModerationItemType.POST,
      4,
      'moderator-id',
      '   ',
    );

    expect(result).toMatchObject({
      isHidden: true,
      hiddenByUserId: 'moderator-id',
      hiddenReason: null,
    });
    expect(postRepository.save).toHaveBeenCalledTimes(1);
  });

  it('restores only content belonging to the URL community', async () => {
    const reply = {
      id: 3,
      isHidden: true,
      hiddenAt: new Date(),
      hiddenByUserId: 'moderator-id',
      hiddenReason: 'reason',
      post: { communityProfile: { communityId: 9 } },
    };
    replyRepository.findOne.mockResolvedValue(reply);

    await expect(
      service.restoreContent(ModerationItemType.REPLY, 3, 8, 'owner-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(replyRepository.save).not.toHaveBeenCalled();
  });

  it('restoring is idempotent and clears moderation fields', async () => {
    const product = {
      id: 5,
      communityId: 8,
      isHidden: true,
      hiddenAt: new Date(),
      hiddenByUserId: 'moderator-id',
      hiddenReason: 'spam',
      seller: { userId: 'product-author' },
    };
    productRepository.findOne.mockResolvedValue(product);
    productRepository.save.mockImplementation((value: unknown) =>
      Promise.resolve(value),
    );
    notificationsService.notify.mockResolvedValue([]);

    const result = await service.restoreContent(
      ModerationItemType.PRODUCT,
      5,
      8,
      'owner-id',
    );

    expect(result).toMatchObject({
      isHidden: false,
      hiddenAt: null,
      hiddenByUserId: null,
      hiddenReason: null,
    });
    expect(notificationsService.notify).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'product-author',
        type: 'content_restored',
      }),
    ]);
  });

  it('notifies the post author only after a real restoration', async () => {
    const post = {
      id: 4,
      isHidden: true,
      hiddenAt: new Date(),
      hiddenByUserId: 'moderator-id',
      hiddenReason: 'spam',
      communityProfile: { communityId: 8, userId: 'post-author' },
    };
    postRepository.findOne.mockResolvedValue(post);
    postRepository.save.mockImplementation((value: unknown) =>
      Promise.resolve(value),
    );
    notificationsService.notify.mockResolvedValue([]);

    await service.restoreContent(ModerationItemType.POST, 4, 8, 'owner-id');

    expect(notificationsService.notify).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'post-author',
        type: 'content_restored',
        data: { itemType: 'post', itemId: 4 },
      }),
    ]);
  });

  it('does not notify when restore is already idempotently visible', async () => {
    const post = {
      id: 4,
      isHidden: false,
      communityProfile: { communityId: 8, userId: 'post-author' },
    };
    postRepository.findOne.mockResolvedValue(post);

    await service.restoreContent(ModerationItemType.POST, 4, 8, 'owner-id');

    expect(notificationsService.notify).not.toHaveBeenCalled();
    expect(postRepository.save).not.toHaveBeenCalled();
  });
});
