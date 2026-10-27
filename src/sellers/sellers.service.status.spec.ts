import { ConflictException } from '@nestjs/common';
import { SellersService } from './sellers.service';
import { SellerRequestStatus, UserRole } from '../users/entities/user.entity';
import { ProductStatus } from '../products/entities/product.entity';
import { Seller } from './entities/seller.entity';
import { User } from '../users/entities/user.entity';

describe('SellersService seller status transitions', () => {
  const targetUserId = 'target-user';
  const actorUserId = 'superadmin-user';

  const create = (status: SellerRequestStatus) => {
    const target = {
      id: targetUserId,
      role: UserRole.SELLER,
      sellerRequestStatus: status,
      currency: 'CRC',
    } as User;
    const seller = {
      sellerId: 42,
      userId: targetUserId,
      isVerified: status === SellerRequestStatus.APPROVED,
      approvedAt: new Date('2026-01-01T00:00:00.000Z'),
    } as Seller;
    const userRepository = {
      findOne: jest.fn().mockResolvedValue(target),
    };
    const sellerRepository = {
      findOne: jest.fn().mockResolvedValue(seller),
    };
    const productQuery = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 2 }),
    };
    const productRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(productQuery),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === User) return userRepository;
        if (entity === Seller) return sellerRepository;
        return productRepository;
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn().mockResolvedValue(target),
    };
    const dataSource = {
      transaction: jest.fn((callback: (value: typeof manager) => unknown) =>
        callback(manager),
      ),
    };
    const moderationActionsService = {
      record: jest.fn().mockResolvedValue({}),
    };
    const notificationsService = { notify: jest.fn().mockResolvedValue([]) };
    const service = new SellersService(
      { findOne: jest.fn() } as never,
      { findById: jest.fn().mockResolvedValue(target) } as never,
      {} as never,
      dataSource as never,
      undefined,
      undefined,
      moderationActionsService as never,
      notificationsService as never,
    );
    return {
      service,
      target,
      seller,
      manager,
      userRepository,
      sellerRepository,
      productQuery,
      moderationActionsService,
      notificationsService,
    };
  };

  it('revokes the seller, inactivates only active products, audits and notifies', async () => {
    const h = create(SellerRequestStatus.APPROVED);

    const result = await h.service.updateSellerStatus(
      targetUserId,
      { status: SellerRequestStatus.REVOKED, reason: ' incumplimiento ' },
      actorUserId,
    );

    expect(result).toBe(h.target);
    expect(h.manager.update).toHaveBeenCalledWith(Seller, 42, {
      isVerified: false,
    });
    expect(h.manager.update).toHaveBeenCalledWith(User, targetUserId, {
      sellerRequestStatus: SellerRequestStatus.REVOKED,
    });
    expect(h.productQuery.set).toHaveBeenCalledWith({
      status: ProductStatus.INACTIVE,
    });
    expect(h.productQuery.where).toHaveBeenCalledWith(
      'seller_id = :sellerId AND status = :active AND deleted_at IS NULL',
      { sellerId: 42, active: ProductStatus.ACTIVE },
    );
    expect(h.moderationActionsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId,
        targetId: targetUserId,
        action: 'seller_revoked',
        reason: 'incumplimiento',
        communityId: null,
      }),
      h.manager,
    );
    expect(h.notificationsService.notify).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: 'seller_revoked',
          userId: targetUserId,
        }),
      ],
      { allowInactiveRecipient: true },
    );
  });

  it('restores seller access without reactivating products', async () => {
    const h = create(SellerRequestStatus.REVOKED);

    await h.service.updateSellerStatus(
      targetUserId,
      { status: SellerRequestStatus.APPROVED },
      actorUserId,
    );

    expect(h.manager.update).toHaveBeenCalledWith(Seller, 42, {
      isVerified: true,
    });
    expect(h.manager.update).toHaveBeenCalledWith(User, targetUserId, {
      sellerRequestStatus: SellerRequestStatus.APPROVED,
    });
    expect(h.productQuery.update).not.toHaveBeenCalled();
    expect(h.moderationActionsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId,
        action: 'seller_restored',
        reason: null,
      }),
      h.manager,
    );
    expect(h.notificationsService.notify).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: 'seller_restored',
          userId: targetUserId,
        }),
      ],
      { allowInactiveRecipient: true },
    );
  });

  it('returns conflict for repeated revoke without side effects', async () => {
    const h = create(SellerRequestStatus.REVOKED);

    await expect(
      h.service.updateSellerStatus(
        targetUserId,
        { status: SellerRequestStatus.REVOKED, reason: 'repetido' },
        actorUserId,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.manager.update).not.toHaveBeenCalled();
    expect(h.moderationActionsService.record).not.toHaveBeenCalled();
    expect(h.notificationsService.notify).not.toHaveBeenCalled();
  });
});
