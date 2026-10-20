import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentHistoryService } from './payment-history.service';
import { TransactionStatus } from './enums/transaction-status.enum';

describe('PaymentHistoryService', () => {
  const seller = { sellerId: 7, userId: 'seller-1' } as never;
  const completed = (overrides = {}) => ({
    id: 'tx-1',
    buyerId: 'buyer-1',
    sellerId: 7,
    amount: 100,
    currency: 'CRC',
    salesTierName: 'Oro',
    priceTierName: 'Alto',
    commissionRate: 0.03,
    commissionAmount: 3,
    sellerNet: 97,
    status: TransactionStatus.COMPLETED,
    failureReason: null,
    cardLast4: '4242',
    gatewayReference: 'SIM-A1B2C3',
    createdAt: new Date('2026-10-19T15:00:00.000Z'),
    completedAt: new Date('2026-10-19T16:00:00.000Z'),
    product: { id: 10, title: 'Producto', imageUrl: '/image.jpg' },
    seller: { sellerId: 7, displayName: 'Vendedor', userId: 'seller-1' },
    buyer: { id: 'buyer-1', username: 'buyer', photoUrl: '/buyer.jpg' },
    ...overrides,
  });

  const createHarness = () => {
    const qb = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[completed()], 1]),
      getMany: jest.fn().mockResolvedValue([completed()]),
      getOne: jest.fn().mockResolvedValue(completed()),
    };
    const transactionRepository = { createQueryBuilder: jest.fn(() => qb) };
    const sellerRepository = { findOne: jest.fn().mockResolvedValue(seller) };
    const usersService = {
      findById: jest.fn().mockResolvedValue({ currency: 'CRC' }),
    };
    const exchangeRateService = {
      getRate: jest
        .fn()
        .mockResolvedValue({ rate: 500, rateDate: '2026-10-19' }),
    };
    const service = new PaymentHistoryService(
      transactionRepository as never,
      sellerRepository as never,
      usersService as never,
      exchangeRateService as never,
    );
    return { service, qb, sellerRepository, usersService, exchangeRateService };
  };

  it('returns purchases with pagination and excludes commission fields', async () => {
    const h = createHarness();
    const result = await h.service.purchases('buyer-1', { page: 2, limit: 10 });
    expect(h.qb.where).toHaveBeenCalledWith('transaction.buyer_id = :userId', {
      userId: 'buyer-1',
    });
    expect(h.qb.andWhere).toHaveBeenCalledWith('transaction.status = :status', {
      status: TransactionStatus.COMPLETED,
    });
    expect(h.qb.select).toHaveBeenCalledWith(
      expect.arrayContaining([
        'transaction.completedAt',
        'transaction.createdAt',
      ]),
    );
    expect(h.qb.orderBy).toHaveBeenCalledWith(
      'transaction.completedAt',
      'DESC',
    );
    expect(h.qb.addOrderBy).toHaveBeenCalledWith(
      'transaction.createdAt',
      'DESC',
    );
    expect(h.qb.skip).toHaveBeenCalledWith(10);
    expect(h.qb.take).toHaveBeenCalledWith(10);
    expect(h.qb.getManyAndCount).toHaveBeenCalledTimes(1);
    expect(result.pagination).toEqual({
      page: 2,
      limit: 10,
      total: 1,
      totalPages: 1,
    });
    expect(result.data[0]).toEqual(
      expect.objectContaining({
        cardLast4: '4242',
        gatewayReference: 'SIM-A1B2C3',
      }),
    );
    expect(result.data[0]).not.toHaveProperty('commissionAmount');
    expect(result.data[0]).not.toHaveProperty('idempotencyKey');
  });

  it('resolves the seller from userId and returns safe sales data', async () => {
    const h = createHarness();
    const result = await h.service.sales('seller-1', { page: 1, limit: 10 });
    expect(h.sellerRepository.findOne).toHaveBeenCalledWith({
      where: { userId: 'seller-1' },
    });
    expect(h.qb.where).toHaveBeenCalledWith(
      'transaction.seller_id = :sellerId',
      { sellerId: 7 },
    );
    expect(h.qb.select).toHaveBeenCalledWith(
      expect.arrayContaining([
        'transaction.completedAt',
        'transaction.createdAt',
      ]),
    );
    expect(h.qb.orderBy).toHaveBeenCalledWith(
      'transaction.completedAt',
      'DESC',
    );
    expect(h.qb.addOrderBy).toHaveBeenCalledWith(
      'transaction.createdAt',
      'DESC',
    );
    expect(h.qb.skip).toHaveBeenCalledWith(0);
    expect(h.qb.take).toHaveBeenCalledWith(10);
    expect(h.qb.getManyAndCount).toHaveBeenCalledTimes(1);
    expect(result.data[0]).toEqual(
      expect.objectContaining({ commissionAmount: 3, sellerNet: 97 }),
    );
    expect(result.data[0].buyer).toEqual({
      id: 'buyer-1',
      username: 'buyer',
      photoUrl: '/buyer.jpg',
    });
    expect(result.data[0].buyer).not.toHaveProperty('email');
  });

  it('rejects sales and summary for a user without Seller', async () => {
    const h = createHarness();
    h.sellerRepository.findOne.mockResolvedValue(null);
    await expect(
      h.service.sales('user-1', { page: 1, limit: 10 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.salesSummary('user-1', {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('builds a same-currency summary without calling exchange rates', async () => {
    const h = createHarness();
    const result = await h.service.salesSummary('seller-1', {});
    expect(result).toMatchObject({ currency: 'CRC', approximate: false });
    expect(result.totals).toEqual({ gross: 100, commissions: 3, net: 97 });
    expect(result.breakdown).toEqual([
      {
        currency: 'CRC',
        gross: 100,
        commissions: 3,
        net: 97,
        transactionCount: 1,
      },
    ]);
    expect(h.exchangeRateService.getRate).not.toHaveBeenCalled();
  });

  it('converts each historical currency/date once and marks the summary approximate', async () => {
    const h = createHarness();
    h.usersService.findById.mockResolvedValue({ currency: 'CRC' });
    h.qb.getMany.mockResolvedValue([
      completed({
        id: 'a',
        currency: 'USD',
        amount: 10,
        commissionAmount: 1,
        sellerNet: 9,
      }),
      completed({
        id: 'b',
        currency: 'USD',
        amount: 20,
        commissionAmount: 2,
        sellerNet: 18,
      }),
    ]);
    const result = await h.service.salesSummary('seller-1', {
      from: '2026-10-19',
      to: '2026-10-19',
    });
    expect(result.approximate).toBe(true);
    expect(result.breakdown[0]).toMatchObject({
      currency: 'USD',
      gross: 30,
      commissions: 3,
      net: 27,
    });
    expect(result.totals).toEqual({
      gross: 15000,
      commissions: 1500,
      net: 13500,
    });
    expect(h.exchangeRateService.getRate).toHaveBeenCalledTimes(1);
    expect(h.exchangeRateService.getRate).toHaveBeenCalledWith('USD', 'CRC', {
      date: '2026-10-19',
    });
    expect(h.qb.andWhere).toHaveBeenCalledWith(
      'transaction.completed_at >= :fromDate',
      expect.any(Object),
    );
    expect(h.qb.andWhere).toHaveBeenCalledWith(
      'transaction.completed_at < :toDate',
      expect.any(Object),
    );
  });

  it('validates summary dates and configured currency', async () => {
    const h = createHarness();
    await expect(
      h.service.salesSummary('seller-1', {
        from: '2026-02-02',
        to: '2026-02-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    h.usersService.findById.mockResolvedValue({ currency: null });
    await expect(h.service.salesSummary('seller-1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('allows buyer and seller to view a receipt, but exposes commission only to seller', async () => {
    const h = createHarness();
    const buyerReceipt = await h.service.receipt('buyer-1', 'tx-1');
    expect(buyerReceipt).not.toHaveProperty('commission');
    const sellerReceipt = await h.service.receipt('seller-1', 'tx-1');
    expect(sellerReceipt.commission).toEqual(
      expect.objectContaining({ commissionAmount: 3, sellerNet: 97 }),
    );
    expect(sellerReceipt).not.toHaveProperty('idempotencyKey');
  });

  it('uses createdAt for failed receipts and rejects missing or unauthorized transactions', async () => {
    const h = createHarness();
    h.qb.getOne.mockResolvedValueOnce(
      completed({
        status: TransactionStatus.FAILED,
        completedAt: null,
        failureReason: 'card_declined',
      }),
    );
    const failed = await h.service.receipt('buyer-1', 'tx-1');
    expect(failed.date).toEqual(new Date('2026-10-19T15:00:00.000Z'));
    expect(failed.failureReason).toBe('card_declined');
    h.qb.getOne.mockResolvedValueOnce(null);
    await expect(
      h.service.receipt('buyer-1', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
    h.qb.getOne.mockResolvedValueOnce(completed());
    await expect(
      h.service.receipt('other-user', 'tx-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
