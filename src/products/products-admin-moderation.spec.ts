import { ConflictException, NotFoundException } from '@nestjs/common';
import { Product, ProductStatus } from './entities/product.entity';
import { ProductsService } from './products.service';
import { SellerRequestStatus, UserRole } from '../users/entities/user.entity';
import { Seller } from '../sellers/entities/seller.entity';

describe('ProductsService administrative moderation', () => {
  const productId = 7;
  const adminId = 'admin-id';
  const sellerUserId = 'seller-id';

  const create = (overrides: Partial<Product> = {}) => {
    const product = {
      id: productId,
      title: 'Producto de prueba',
      price: 100,
      discountPercent: null,
      quantity: 2,
      status: ProductStatus.ACTIVE,
      isVisible: true,
      isHidden: false,
      isDeactivated: false,
      deletedAt: null,
      communityId: 3,
      seller: { sellerId: 11, userId: sellerUserId } as Seller,
      ...overrides,
    } as Product;
    const productRepository = {
      findOne: jest.fn().mockResolvedValue(product),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(productRepository),
      update: jest.fn().mockImplementation((_entity, _id, values) => {
        Object.assign(product, values);
        return Promise.resolve({ affected: 1 });
      }),
      softDelete: jest.fn().mockImplementation(() => {
        product.deletedAt = new Date();
        return Promise.resolve({ affected: 1 });
      }),
      findOne: jest.fn().mockResolvedValue(product),
    };
    const dataSource = {
      transaction: jest.fn((callback: (value: typeof manager) => unknown) =>
        callback(manager),
      ),
    };
    const moderationActionsService = {
      record: jest.fn().mockResolvedValue({}),
    };
    const notificationsService = {
      notify: jest.fn().mockResolvedValue([]),
    };
    const usersService = {
      findById: jest.fn().mockResolvedValue({
        id: adminId,
        role: UserRole.SUPERADMIN,
        sellerRequestStatus: SellerRequestStatus.NONE,
      }),
    };
    const emptyRepository = {} as never;
    const service = new ProductsService(
      productRepository as never,
      emptyRepository,
      emptyRepository,
      emptyRepository,
      emptyRepository,
      emptyRepository,
      emptyRepository,
      emptyRepository,
      usersService as never,
      emptyRepository,
      emptyRepository,
      dataSource as never,
      emptyRepository,
      undefined,
      moderationActionsService as never,
      notificationsService as never,
    );
    return {
      service,
      product,
      productRepository,
      manager,
      moderationActionsService,
      notificationsService,
      usersService,
    };
  };

  it('deactivates without changing commercial or hidden state', async () => {
    const h = create({ status: ProductStatus.INACTIVE, isHidden: true });

    await h.service.deactivateByAdmin(productId, adminId, {
      reason: ' Incumplimiento ',
    });

    expect(h.product).toMatchObject({
      status: ProductStatus.INACTIVE,
      isDeactivated: true,
      isHidden: true,
    });
    expect(h.moderationActionsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: adminId,
        targetType: 'product',
        targetId: productId,
        action: 'product_deactivated',
        reason: 'Incumplimiento',
        communityId: 3,
      }),
      h.manager,
    );
    expect(h.notificationsService.notify).toHaveBeenCalledTimes(1);
  });

  it('returns conflict for repeated deactivation without side effects', async () => {
    const h = create({ isDeactivated: true });

    await expect(
      h.service.deactivateByAdmin(productId, adminId, { reason: 'repetido' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.moderationActionsService.record).not.toHaveBeenCalled();
    expect(h.notificationsService.notify).not.toHaveBeenCalled();
  });

  it('activates only the administrative flag and preserves sold status', async () => {
    const h = create({ status: ProductStatus.SOLD, isDeactivated: true });

    await h.service.activateByAdmin(productId, adminId, {
      reason: 'Revisión concluida',
    });

    expect(h.product).toMatchObject({
      status: ProductStatus.SOLD,
      isDeactivated: false,
    });
    expect(h.moderationActionsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'product_activated',
        reason: 'Revisión concluida',
      }),
      h.manager,
    );
  });

  it('allows SUPERADMIN to soft-delete any product and audits once', async () => {
    const h = create();

    await h.service.remove(productId, adminId, {
      reason: 'Retiro administrativo',
    });

    expect(h.manager.softDelete).toHaveBeenCalledWith(Product, productId);
    expect(h.moderationActionsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: adminId,
        action: 'product_soft_deleted',
        reason: 'Retiro administrativo',
      }),
      h.manager,
    );
    expect(h.notificationsService.notify).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for an already soft-deleted product in administrative actions', async () => {
    const h = create();
    h.productRepository.findOne.mockResolvedValue(null);

    await expect(
      h.service.deactivateByAdmin(productId, adminId, { reason: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
