/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { ShippingStatus } from './enums/shipping-status.enum';
import { TransactionStatus } from './enums/transaction-status.enum';

describe('PaymentsService shipping transitions', () => {
  const sellerUserId = 'seller-user';
  const buyerUserId = 'buyer-user';

  const makeTransaction = (overrides: Partial<PaymentTransaction> = {}) =>
    ({
      id: 'transaction-1',
      productId: 7,
      sellerId: 3,
      buyerId: buyerUserId,
      status: TransactionStatus.COMPLETED,
      shippingStatus: ShippingStatus.PAID,
      shippingAddress: { fullName: 'Buyer', line1: 'Street' },
      trackingNumber: null,
      carrier: null,
      shippedAt: null,
      deliveredAt: null,
      seller: { userId: sellerUserId },
      ...overrides,
    }) as PaymentTransaction;

  const harness = (transaction = makeTransaction()) => {
    const repository = {
      findOne: jest.fn().mockResolvedValue(transaction),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(repository),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const eventEmitter = { emit: jest.fn() };
    const service = new PaymentsService(
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      eventEmitter as never,
    );
    return { service, repository, dataSource, eventEmitter, transaction };
  };

  it('ships a paid transaction and emits only after the transaction callback succeeds', async () => {
    const h = harness();

    await expect(
      h.service.ship(h.transaction.id, sellerUserId, {
        trackingNumber: '  ABC123  ',
        carrier: '  Correos  ',
      }),
    ).resolves.toMatchObject({
      transactionId: h.transaction.id,
      paymentStatus: TransactionStatus.COMPLETED,
      shippingStatus: ShippingStatus.SHIPPED,
      trackingNumber: 'ABC123',
      carrier: 'Correos',
    });

    expect(h.transaction.shippedAt).toBeInstanceOf(Date);
    expect(h.transaction.deliveredAt).toBeNull();
    expect(h.eventEmitter.emit).toHaveBeenCalledWith(
      'payment.order.shipped',
      expect.objectContaining({ buyerId: buyerUserId }),
    );
    expect(h.repository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
  });

  it('normalizes omitted shipping details to null', async () => {
    const h = harness();

    await h.service.ship(h.transaction.id, sellerUserId, {});

    expect(h.transaction.trackingNumber).toBeNull();
    expect(h.transaction.carrier).toBeNull();
  });

  it('rejects ship for a non-owner, an invalid state, and a legacy transaction', async () => {
    await expect(
      harness().service.ship('transaction-1', buyerUserId, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      harness(
        makeTransaction({ shippingStatus: ShippingStatus.SHIPPED }),
      ).service.ship('transaction-1', sellerUserId, {}),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      harness(
        makeTransaction({ shippingStatus: null, shippingAddress: null }),
      ).service.ship('transaction-1', sellerUserId, {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('delivers only a shipped transaction for its buyer', async () => {
    const transaction = makeTransaction({
      shippingStatus: ShippingStatus.SHIPPED,
    });
    transaction.shippedAt = new Date();
    const h = harness(transaction);

    await expect(
      h.service.deliver(transaction.id, buyerUserId),
    ).resolves.toMatchObject({
      transactionId: transaction.id,
      paymentStatus: TransactionStatus.COMPLETED,
      shippingStatus: ShippingStatus.DELIVERED,
    });

    expect(transaction.deliveredAt).toBeInstanceOf(Date);
    expect(h.eventEmitter.emit).toHaveBeenCalledWith(
      'payment.order.delivered',
      expect.objectContaining({ sellerId: transaction.sellerId }),
    );
  });

  it('rejects deliver for a non-buyer and for duplicate delivery', async () => {
    await expect(
      harness(
        makeTransaction({ shippingStatus: ShippingStatus.SHIPPED }),
      ).service.deliver('transaction-1', sellerUserId),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      harness(
        makeTransaction({ shippingStatus: ShippingStatus.DELIVERED }),
      ).service.deliver('transaction-1', buyerUserId),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns not found when the transaction does not exist', async () => {
    const h = harness();
    h.repository.findOne.mockResolvedValue(null);

    await expect(
      h.service.ship('missing', sellerUserId, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
