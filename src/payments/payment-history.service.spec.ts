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
    cardHolderName: 'María José Núñez',
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
      withDeleted: jest.fn().mockReturnThis(),
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
    const reviewRepository = { find: jest.fn().mockResolvedValue([]) };
    const service = new PaymentHistoryService(
      transactionRepository as never,
      sellerRepository as never,
      usersService as never,
      exchangeRateService as never,
      reviewRepository as never,
    );
    return {
      service,
      qb,
      sellerRepository,
      usersService,
      exchangeRateService,
      reviewRepository,
    };
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
        cardHolderName: 'María José Núñez',
        gatewayReference: 'SIM-A1B2C3',
      }),
    );
    expect(h.qb.addSelect).toHaveBeenCalledWith(
      expect.arrayContaining(['transaction.cardHolderName']),
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

  it('returns the card holder name in the receipt only to the buyer', async () => {
    const h = createHarness();

    const buyerReceipt = await h.service.receipt('buyer-1', 'tx-1');
    expect(buyerReceipt).toMatchObject({
      cardLast4: '4242',
      cardHolderName: 'María José Núñez',
    });

    const sellerReceipt = await h.service.receipt('seller-1', 'tx-1');
    expect(sellerReceipt).not.toHaveProperty('cardHolderName');
  });

  it('returns null holder name for transactions created before the field', async () => {
    const h = createHarness();
    h.qb.getOne.mockResolvedValueOnce(completed({ cardHolderName: null }));
    h.qb.getManyAndCount.mockResolvedValueOnce([
      [completed({ cardHolderName: null })],
      1,
    ]);

    await expect(h.service.receipt('buyer-1', 'tx-1')).resolves.toMatchObject({
      cardHolderName: null,
    });
    const purchases = await h.service.purchases('buyer-1', {
      page: 1,
      limit: 10,
    });
    expect(purchases.data[0].cardHolderName).toBeNull();
  });

  it('never exposes the holder name in the seller sales list', async () => {
    const h = createHarness();

    const result = await h.service.sales('seller-1', { page: 1, limit: 10 });

    expect(result.data[0]).not.toHaveProperty('cardHolderName');
    expect(result.data[0]).not.toHaveProperty('cardLast4');
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
  describe('purchases: canReview, hasReviewed y reviewId en lote', () => {
    const buyer = 'buyer-1';
    const item = (id: string, productId: number, overrides = {}) =>
      completed({
        id,
        product: {
          id: productId,
          title: `Producto ${productId}`,
          imageUrl: null,
          type: 'sale',
        },
        ...overrides,
      });

    it('hace una sola consulta de reseñas para toda la página', async () => {
      const h = createHarness();
      h.qb.getManyAndCount.mockResolvedValue([
        [item('a', 10), item('b', 10), item('c', 11), item('d', 12)],
        4,
      ]);

      await h.service.purchases(buyer, { page: 1, limit: 10 });

      expect(h.reviewRepository.find).toHaveBeenCalledTimes(1);
      const [options] = h.reviewRepository.find.mock.calls[0] as [
        { where: { authorId: string; productId: { value: number[] } } },
      ];
      expect(options.where.authorId).toBe(buyer);
      expect(options.where.productId.value).toEqual([10, 11, 12]);
    });

    it('calcula los tres campos por ítem con la regla compartida', async () => {
      const h = createHarness();
      h.reviewRepository.find.mockResolvedValue([{ id: 5, productId: 11 }]);
      h.qb.getManyAndCount.mockResolvedValue([
        [
          item('a', 10),
          item('b', 10),
          item('c', 11),
          item('d', 12, {
            product: {
              id: 12,
              title: 'Intercambio',
              imageUrl: null,
              type: 'exchange',
            },
          }),
          item('e', 13, {
            seller: { sellerId: 7, displayName: 'Yo', userId: buyer },
          }),
        ],
        5,
      ]);

      const { data } = await h.service.purchases(buyer, { page: 1, limit: 10 });
      const fields = data.map(({ canReview, hasReviewed, reviewId }) => ({
        canReview,
        hasReviewed,
        reviewId,
      }));

      expect(fields).toEqual([
        { canReview: true, hasReviewed: false, reviewId: null },
        { canReview: true, hasReviewed: false, reviewId: null },
        { canReview: false, hasReviewed: true, reviewId: 5 },
        { canReview: false, hasReviewed: false, reviewId: null },
        { canReview: false, hasReviewed: false, reviewId: null },
      ]);
    });

    it('no consulta reseñas cuando la página está vacía', async () => {
      const h = createHarness();
      h.qb.getManyAndCount.mockResolvedValue([[], 0]);

      const result = await h.service.purchases(buyer, { page: 1, limit: 10 });

      expect(result.data).toEqual([]);
      expect(h.reviewRepository.find).not.toHaveBeenCalled();
    });

    it('selecciona el tipo de producto y el userId del vendedor para la regla', async () => {
      const h = createHarness();

      await h.service.purchases(buyer, { page: 1, limit: 10 });

      expect(h.qb.addSelect).toHaveBeenCalledWith(
        expect.arrayContaining(['product.type', 'seller.userId']),
      );
    });
  });
  describe('purchases: productos borrados (soft delete)', () => {
    const buyer = 'buyer-1';
    const product = (overrides = {}) => ({
      id: 10,
      title: 'Producto',
      imageUrl: null,
      type: 'sale',
      deletedAt: null,
      ...overrides,
    });

    it('no excluye los productos borrados al consultar el historial', async () => {
      const h = createHarness();

      await h.service.purchases(buyer, { page: 1, limit: 10 });

      expect(h.qb.withDeleted).toHaveBeenCalledTimes(1);
      expect(h.qb.addSelect).toHaveBeenCalledWith(
        expect.arrayContaining(['product.deletedAt']),
      );
      // Solo se piden los campos mínimos del producto.
      const selected = h.qb.addSelect.mock.calls
        .flatMap(([fields]: [string[]]) => fields)
        .filter((field: string) => field.startsWith('product.'));
      expect(selected).toEqual([
        'product.id',
        'product.title',
        'product.imageUrl',
        'product.type',
        'product.deletedAt',
      ]);
    });

    it('la compra de un producto borrado aparece con productDeleted true y canReview true', async () => {
      const h = createHarness();
      h.qb.getManyAndCount.mockResolvedValue([
        [completed({ id: 'a', product: product({ deletedAt: new Date() }) })],
        1,
      ]);

      const { data } = await h.service.purchases(buyer, { page: 1, limit: 10 });

      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({
        productDeleted: true,
        canReview: true,
        hasReviewed: false,
        reviewId: null,
      });
    });

    it('la compra de un producto activo tiene productDeleted false', async () => {
      const h = createHarness();
      h.qb.getManyAndCount.mockResolvedValue([[completed({ id: 'a' })], 1]);

      const { data } = await h.service.purchases(buyer, { page: 1, limit: 10 });

      expect(data[0]).toMatchObject({ productDeleted: false });
    });

    it('un producto borrado ya reseñado mantiene hasReviewed y reviewId y canReview false', async () => {
      const h = createHarness();
      h.reviewRepository.find.mockResolvedValue([{ id: 8, productId: 10 }]);
      h.qb.getManyAndCount.mockResolvedValue([
        [completed({ id: 'a', product: product({ deletedAt: new Date() }) })],
        1,
      ]);

      const { data } = await h.service.purchases(buyer, { page: 1, limit: 10 });

      expect(data[0]).toMatchObject({
        productDeleted: true,
        canReview: false,
        hasReviewed: true,
        reviewId: 8,
      });
    });

    it('mezcla productos borrados y activos en la misma página', async () => {
      const h = createHarness();
      h.qb.getManyAndCount.mockResolvedValue([
        [
          completed({
            id: 'a',
            product: product({ id: 10, deletedAt: new Date() }),
          }),
          completed({ id: 'b', product: product({ id: 11 }) }),
        ],
        2,
      ]);

      const { data } = await h.service.purchases(buyer, { page: 1, limit: 10 });

      expect(data.map((item) => item.productDeleted)).toEqual([true, false]);
      expect(h.reviewRepository.find).toHaveBeenCalledTimes(1);
    });

    it('el comprobante también se puede abrir si el producto fue borrado', async () => {
      const h = createHarness();

      await h.service.receipt(buyer, 'tx-1');

      expect(h.qb.withDeleted).toHaveBeenCalledTimes(1);
    });
  });
});
