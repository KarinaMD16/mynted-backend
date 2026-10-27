import { Repository } from 'typeorm';
import { Post } from '../community/entities/post.entity';
import { Reply } from '../community/entities/reply.entity';
import { Product } from '../products/entities/product.entity';
import { ModerationService } from '../moderation/moderation.service';
import { ModerationActionsService } from '../moderation-actions/moderation-actions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { ResponseTimeService } from '../response-time/response-time.service';
import { Seller } from '../sellers/entities/seller.entity';
import { UserOAuthAccount } from './entities/user-oauth-account.entity';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

const queryBuilder = (rows: Array<{ id: number }>) => {
  const qb = {
    innerJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };
  return qb;
};

describe('UsersService account deactivation effects', () => {
  it('hides all visible content in one transaction and records the account action', async () => {
    const user = Object.assign(new User(), {
      id: 'target-id',
      role: 'user',
      isActive: true,
    });
    const userRepository = {
      findOne: jest.fn().mockResolvedValue(user),
      save: jest.fn().mockResolvedValue(user),
    };
    const postRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder([{ id: 1 }])),
    };
    const replyRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder([{ id: 2 }])),
    };
    const productRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder([{ id: 3 }])),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === User
          ? userRepository
          : entity === Post
            ? postRepository
            : entity === Reply
              ? replyRepository
              : productRepository,
      ),
    };
    const dataSource = {
      transaction: jest.fn((callback: (value: typeof manager) => unknown) =>
        callback(manager),
      ),
    };
    const moderationService = {
      hideContent: jest.fn(),
      restoreContent: jest.fn(),
    };
    const actionsService = { record: jest.fn() };
    const notificationsService = { notify: jest.fn() };
    const service = new UsersService(
      userRepository as unknown as Repository<User>,
      {} as Repository<UserOAuthAccount>,
      {} as CloudinaryService,
      {} as Repository<Seller>,
      {} as ResponseTimeService,
      undefined,
      postRepository as unknown as Repository<Post>,
      replyRepository as unknown as Repository<Reply>,
      productRepository as unknown as Repository<Product>,
      dataSource as never,
      moderationService as unknown as ModerationService,
      actionsService as unknown as ModerationActionsService,
      notificationsService as unknown as NotificationsService,
    );

    await service.deactivate('target-id', 'admin-id', 'Incumplimiento');

    expect(moderationService.hideContent).toHaveBeenCalledTimes(3);
    expect(moderationService.hideContent).toHaveBeenCalledWith(
      'post',
      1,
      'admin-id',
      'user_deactivated',
      manager,
    );
    expect(actionsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'user',
        targetId: 'target-id',
        action: 'user_deactivated',
        reason: 'Incumplimiento',
        communityId: null,
      }),
      manager,
    );
    expect(notificationsService.notify).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          userId: 'target-id',
          type: 'user_deactivated',
        }),
      ],
      { allowInactiveRecipient: true },
    );
  });

  it('restores only user_deactivated content without individual notifications', async () => {
    const user = Object.assign(new User(), {
      id: 'target-id',
      isActive: false,
    });
    const userRepository = {
      findOne: jest.fn().mockResolvedValue(user),
      save: jest.fn().mockResolvedValue(user),
    };
    const repository = (rows: Array<{ id: number }>) => ({
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder(rows)),
    });
    const postRepository = repository([{ id: 1 }]);
    const replyRepository = repository([]);
    const productRepository = repository([{ id: 3 }]);
    const manager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === User
          ? userRepository
          : entity === Post
            ? postRepository
            : entity === Reply
              ? replyRepository
              : productRepository,
      ),
    };
    const dataSource = {
      transaction: jest.fn((callback: (value: typeof manager) => unknown) =>
        callback(manager),
      ),
    };
    const moderationService = {
      hideContent: jest.fn(),
      restoreContent: jest.fn(),
    };
    const actionsService = { record: jest.fn() };
    const notificationsService = { notify: jest.fn() };
    const service = new UsersService(
      userRepository as unknown as Repository<User>,
      {} as Repository<UserOAuthAccount>,
      {} as CloudinaryService,
      {} as Repository<Seller>,
      {} as ResponseTimeService,
      undefined,
      postRepository as unknown as Repository<Post>,
      replyRepository as unknown as Repository<Reply>,
      productRepository as unknown as Repository<Product>,
      dataSource as never,
      moderationService as unknown as ModerationService,
      actionsService as unknown as ModerationActionsService,
      notificationsService as unknown as NotificationsService,
    );

    await service.activate('target-id', 'admin-id');

    expect(moderationService.restoreContent).toHaveBeenCalledTimes(2);
    expect(moderationService.restoreContent).toHaveBeenCalledWith(
      'post',
      1,
      undefined,
      'admin-id',
      manager,
      { notifyAuthor: false },
    );
    expect(actionsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'user',
        targetId: 'target-id',
        action: 'user_reactivated',
        reason: null,
      }),
      manager,
    );
    expect(notificationsService.notify).toHaveBeenCalledTimes(1);
  });
});
