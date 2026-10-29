/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { Product, ProductStatus } from '../products/entities/product.entity';
import { Seller } from '../sellers/entities/seller.entity';
import { TransactionStatus } from './enums/transaction-status.enum';
import { ShippingStatus } from './enums/shipping-status.enum';

describe('PaymentsService cancellation', () => {
  const transaction = () =>
    ({
      id: 'tx-1',
      productId: 7,
      sellerId: 3,
      buyerId: 'buyer-1',
      status: TransactionStatus.COMPLETED,
      shippingStatus: ShippingStatus.PAID,
      shippingAddress: { fullName: 'Buyer' },
      quantity: 2,
      seller: { userId: 'seller-1' },
      commissionAmount: 10,
      commissionRate: 0.1,
      sellerNet: 90,
    }) as PaymentTransaction;

  const harness = (productOverrides: Partial<Product> = {}) => {
    const tx = transaction();
    const product = {
      id: 7,
      quantity: 0,
      status: ProductStatus.SOLD,
      deletedAt: null,
      isHidden: false,
      isDeactivated: false,
      ...productOverrides,
    } as Product;
    const seller = {
      sellerId: 3,
      userId: 'seller-1',
      completedSalesCount: 4,
    } as Seller;
    const txRepository = {
      findOne: jest.fn().mockResolvedValue(tx),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const productRepository = {
      findOne: jest.fn().mockResolvedValue(product),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const sellerRepository = {
      findOne: jest.fn().mockResolvedValue(seller),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === PaymentTransaction) return txRepository;
        if (entity === Product) return productRepository;
        return sellerRepository;
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const eventEmitter = { emit: jest.fn() };
    const service = new PaymentsService(
      dataSource as never,
      productRepository as never,
      sellerRepository as never,
      txRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      eventEmitter as never,
    );
    return {
      service,
      tx,
      product,
      seller,
      txRepository,
      productRepository,
      sellerRepository,
      eventEmitter,
    };
  };

  it('refunds before shipping, restores stock, decrements seller count and notifies once', async () => {
    const h = harness();

    await expect(
      h.service.cancel('tx-1', 'seller-1', { reason: 'No disponibilidad' }),
    ).resolves.toEqual({
      transactionId: 'tx-1',
      paymentStatus: TransactionStatus.REFUNDED,
      shippingStatus: ShippingStatus.PAID,
    });

    expect(h.tx.status).toBe(TransactionStatus.REFUNDED);
    expect(h.tx.cancellationReason).toBe('No disponibilidad');
    expect(h.product.quantity).toBe(2);
    expect(h.product.status).toBe(ProductStatus.ACTIVE);
    expect(h.seller.completedSalesCount).toBe(3);
    expect(h.eventEmitter.emit).toHaveBeenCalledTimes(1);
  });

  it('restores stock without reactivating moderated products', async () => {
    const h = harness({ isHidden: true });

    await h.service.cancel('tx-1', 'seller-1', {});

    expect(h.product.quantity).toBe(2);
    expect(h.product.status).toBe(ProductStatus.SOLD);
  });

  it('rejects the buyer and invalid shipping/payment states', async () => {
    await expect(
      harness().service.cancel('tx-1', 'buyer-1', {}),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const h = harness();
    h.tx.shippingStatus = ShippingStatus.SHIPPED;
    await expect(
      h.service.cancel('tx-1', 'seller-1', {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
