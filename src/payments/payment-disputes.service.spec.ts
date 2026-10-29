/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PaymentDisputesService } from './payment-disputes.service';
import { PaymentDispute } from './entities/payment-dispute.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { ShippingStatus } from './enums/shipping-status.enum';
import { TransactionStatus } from './enums/transaction-status.enum';
import { PaymentDisputeStatus } from './enums/payment-dispute-status.enum';
import { PaymentDisputeAction } from './enums/payment-dispute-action.enum';

describe('PaymentDisputesService', () => {
  const makeTransaction = () =>
    ({
      id: 'tx-1',
      productId: 7,
      sellerId: 3,
      buyerId: 'buyer-1',
      status: TransactionStatus.COMPLETED,
      shippingStatus: ShippingStatus.DELIVERED,
      seller: { sellerId: 3, userId: 'seller-1' },
      product: { id: 7, title: 'Producto' },
    }) as PaymentTransaction;

  const harness = () => {
    const tx = makeTransaction();
    const dispute = {
      id: 'dispute-1',
      transactionId: 'tx-1',
      buyerId: 'buyer-1',
      status: PaymentDisputeStatus.OPEN,
      reason: 'No corresponde',
      resolution: null,
      resolutionNote: null,
      resolvedAt: null,
      createdAt: new Date(),
      transaction: tx,
      buyer: { id: 'buyer-1', username: 'buyer' },
    } as PaymentDispute;
    const txRepository = {
      findOne: jest.fn().mockResolvedValue(tx),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const disputeRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => ({ id: 'dispute-1', ...value })),
      save: jest
        .fn()
        .mockImplementation(async (value) => ({ ...dispute, ...value })),
      createQueryBuilder: jest.fn(),
    };
    const sellerRepository = {
      findOne: jest.fn().mockResolvedValue({
        sellerId: 3,
        userId: 'seller-1',
        completedSalesCount: 4,
      }),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === PaymentDispute) return disputeRepository;
        if (entity === PaymentTransaction) return txRepository;
        return sellerRepository;
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const moderationActionsService = {
      record: jest.fn().mockResolvedValue({}),
    };
    const eventEmitter = { emit: jest.fn() };
    const service = new PaymentDisputesService(
      dataSource as never,
      disputeRepository as never,
      txRepository as never,
      moderationActionsService as never,
      eventEmitter as never,
    );
    return {
      service,
      tx,
      dispute,
      disputeRepository,
      sellerRepository,
      moderationActionsService,
      eventEmitter,
    };
  };

  it('creates only a delivered buyer dispute', async () => {
    const h = harness();
    jest.spyOn(h.service, 'findById').mockResolvedValue(h.dispute as never);

    await expect(
      h.service.create('tx-1', 'buyer-1', { reason: 'No corresponde' }),
    ).resolves.toBe(h.dispute);
    expect(h.disputeRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: 'tx-1',
        status: PaymentDisputeStatus.OPEN,
      }),
    );
  });

  it('rejects seller access and duplicate disputes', async () => {
    const h = harness();
    await expect(
      h.service.create('tx-1', 'seller-1', { reason: 'No corresponde' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const duplicate = harness();
    duplicate.disputeRepository.findOne.mockResolvedValue(duplicate.dispute);
    await expect(
      duplicate.service.create('tx-1', 'buyer-1', { reason: 'Otra razón' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('resolves a dispute with refund without restoring stock and audits it', async () => {
    const h = harness();
    h.disputeRepository.findOne.mockResolvedValue(h.dispute);
    jest.spyOn(h.service, 'findById').mockResolvedValue(h.dispute as never);

    await h.service.resolve('dispute-1', 'admin-1', {
      action: PaymentDisputeAction.REFUND,
      resolution: 'Reembolso aprobado',
    });

    expect(h.tx.status).toBe(TransactionStatus.REFUNDED);
    expect(h.sellerRepository.save).toHaveBeenCalled();
    expect(h.moderationActionsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'payment_dispute',
        targetId: 'dispute-1',
        action: 'payment_dispute_refunded',
      }),
      h.service ? expect.anything() : undefined,
    );
    expect(h.eventEmitter.emit).toHaveBeenCalledTimes(1);
  });
});
