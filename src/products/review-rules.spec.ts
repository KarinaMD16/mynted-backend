/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryFailedError, Repository } from 'typeorm';
import { PaymentTransaction } from '../payments/entities/payment-transaction.entity';
import { TransactionStatus } from '../payments/enums/transaction-status.enum';
import { CreateReviewDto, UpdateReviewDto } from './dto/review.dto';
import { Product, ProductStatus, ProductType } from './entities/product.entity';
import { Review } from './entities/review.entity';
import { ReviewsService } from './reviews.service';

// Pruebas de las reglas de reseñas contra un "mundo" en memoria (productos,
// pagos y reseñas), para cubrir los escenarios completos sin acoplarse a
// cada consulta.
describe('Reglas de reseñas (compra completada, borrado, reembolso, rating)', () => {
  const productId = 22;
  const ownerId = 'owner-id';
  const buyerId = 'buyer-id';
  const otherBuyerId = 'other-buyer-id';

  interface FakeProduct {
    id: number;
    type: ProductType;
    status: ProductStatus;
    deletedAt: Date | null;
    seller: { sellerId: number; userId: string };
  }
  interface FakeTransaction {
    productId: number;
    buyerId: string;
    status: TransactionStatus;
  }
  interface FakeReview {
    id: number;
    productId: number;
    authorId: string;
    rating: number;
    comment: string | null;
    createdAt: Date;
    updatedAt: Date;
  }

  let products: FakeProduct[];
  let transactions: FakeTransaction[];
  let reviews: FakeReview[];
  let nextReviewId: number;
  let service: ReviewsService;
  let cosmeticsService: { getEffectiveSummaryForUsers: jest.Mock };

  const aProduct = (overrides: Partial<FakeProduct> = {}): FakeProduct => ({
    id: productId,
    type: ProductType.SALE,
    status: ProductStatus.ACTIVE,
    deletedAt: null,
    seller: { sellerId: 7, userId: ownerId },
    ...overrides,
  });
  const purchase = (
    status: TransactionStatus,
    userId = buyerId,
  ): FakeTransaction => ({ productId, buyerId: userId, status });

  const uniqueViolation = () =>
    new QueryFailedError(
      'INSERT INTO review',
      [],
      Object.assign(new Error('duplicate key'), { code: '23505' }),
    );

  beforeEach(() => {
    products = [aProduct()];
    transactions = [];
    reviews = [];
    nextReviewId = 1;

    const toEntity = (review: FakeReview) => ({
      ...review,
      author: {
        id: review.authorId,
        username: `user-${review.authorId}`,
        photoUrl: null,
      },
    });

    const reviewRepository = {
      create: (data: Partial<FakeReview>) => ({ ...data }),
      save: async (review: Partial<FakeReview>) => {
        if (review.id !== undefined) {
          const existing = reviews.find((item) => item.id === review.id)!;
          Object.assign(existing, review, { updatedAt: new Date() });
          return existing;
        }
        // Índice único (productId, authorId): lo decide la base de datos.
        if (
          reviews.some(
            (item) =>
              item.productId === review.productId &&
              item.authorId === review.authorId,
          )
        ) {
          throw uniqueViolation();
        }
        const saved: FakeReview = {
          id: nextReviewId++,
          productId: review.productId!,
          authorId: review.authorId!,
          rating: review.rating!,
          comment: review.comment ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        reviews.push(saved);
        return saved;
      },
      findOne: async ({
        where,
      }: {
        where: { productId: number; authorId: string };
      }) =>
        reviews.find(
          (item) =>
            item.productId === where.productId &&
            item.authorId === where.authorId,
        ) ?? null,
      findOneOrFail: async ({ where }: { where: { id: number } }) =>
        toEntity(reviews.find((item) => item.id === where.id)!),
      findAndCount: async ({
        where,
        skip,
        take,
      }: {
        where: { productId: number };
        skip: number;
        take: number;
      }) => {
        const all = reviews
          .filter((item) => item.productId === where.productId)
          .sort((a, b) => b.id - a.id);
        return [all.slice(skip, skip + take).map(toEntity), all.length];
      },
      delete: async (id: number) => {
        reviews = reviews.filter((item) => item.id !== id);
      },
      // AVG / COUNT sobre las reseñas del producto, como en la base real.
      createQueryBuilder: () => {
        let id = 0;
        const builder = {
          select: () => builder,
          addSelect: () => builder,
          where: (_sql: string, params: { productId: number }) => {
            id = params.productId;
            return builder;
          },
          getRawOne: async () => {
            const own = reviews.filter((item) => item.productId === id);
            const average = own.length
              ? (
                  Math.round(
                    (own.reduce((sum, item) => sum + item.rating, 0) /
                      own.length) *
                      10,
                  ) / 10
                ).toFixed(1)
              : null;
            return { average, count: String(own.length) };
          },
        };
        return builder;
      },
    };
    const productRepository = {
      findOne: async ({ where }: { where: { id: number } }) =>
        products.find((item) => item.id === where.id) ?? null,
    };
    const transactionRepository = {
      existsBy: async (where: FakeTransaction) =>
        transactions.some(
          (item) =>
            item.productId === where.productId &&
            item.buyerId === where.buyerId &&
            item.status === where.status,
        ),
    };

    cosmeticsService = {
      getEffectiveSummaryForUsers: jest.fn((ids: string[]) =>
        Promise.resolve(
          new Map(
            ids.map((id) => [
              id,
              {
                isPro: false,
                frame: { code: 'frame_default', assetUrl: null },
              },
            ]),
          ),
        ),
      ),
    };

    service = new ReviewsService(
      reviewRepository as unknown as Repository<Review>,
      productRepository as unknown as Repository<Product>,
      transactionRepository as unknown as Repository<PaymentTransaction>,
      cosmeticsService as never,
    );
  });

  const create = (userId = buyerId, rating = 5) =>
    service.create(productId, userId, { rating });

  describe('solo una compra con pago completed habilita reseñar', () => {
    it('sin compra: 403', async () => {
      await expect(create()).rejects.toThrow(
        new ForbiddenException(
          'Solo puedes reseñar productos que hayas comprado',
        ),
      );
      expect(reviews).toHaveLength(0);
    });

    it('con compra completed: crea la reseña', async () => {
      transactions.push(purchase(TransactionStatus.COMPLETED));

      await expect(create()).resolves.toMatchObject({
        productId,
        rating: 5,
        isMine: true,
      });
      expect(reviews).toHaveLength(1);
    });

    it.each([
      TransactionStatus.FAILED,
      TransactionStatus.PENDING,
      TransactionStatus.REFUNDED,
    ])('con un pago %s: 403', async (status) => {
      transactions.push(purchase(status));

      await expect(create()).rejects.toBeInstanceOf(ForbiddenException);
      expect(reviews).toHaveLength(0);
    });

    it('un pago failed junto a uno completed sí habilita (cuenta el completed)', async () => {
      transactions.push(
        purchase(TransactionStatus.FAILED),
        purchase(TransactionStatus.COMPLETED),
      );

      await expect(create()).resolves.toBeDefined();
    });

    it('comprar varias veces no da más de una reseña: la segunda es 409', async () => {
      transactions.push(
        purchase(TransactionStatus.COMPLETED),
        purchase(TransactionStatus.COMPLETED),
      );

      await create();
      await expect(create(buyerId, 3)).rejects.toThrow(
        new ConflictException('Ya reseñaste este producto'),
      );
      expect(reviews).toHaveLength(1);
    });

    it('el vendedor no puede reseñar lo suyo (403), aunque tenga una compra', async () => {
      transactions.push(purchase(TransactionStatus.COMPLETED, ownerId));

      await expect(create(ownerId)).rejects.toThrow(
        new ForbiddenException('No puedes reseñar tu propio producto'),
      );
    });

    it('un producto de intercambio no se puede reseñar (403)', async () => {
      products = [aProduct({ type: ProductType.EXCHANGE })];
      transactions.push(purchase(TransactionStatus.COMPLETED));

      await expect(create()).rejects.toThrow(
        new ForbiddenException(
          'Los productos de intercambio todavía no se pueden reseñar',
        ),
      );
    });
  });

  describe('dos peticiones simultáneas', () => {
    it('del mismo usuario: solo una pasa y la otra recibe 409', async () => {
      transactions.push(purchase(TransactionStatus.COMPLETED));

      const results = await Promise.allSettled([create(), create()]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(reviews).toHaveLength(1);
    });

    it('de usuarios distintos: ambas pasan', async () => {
      transactions.push(
        purchase(TransactionStatus.COMPLETED),
        purchase(TransactionStatus.COMPLETED, otherBuyerId),
      );

      const results = await Promise.allSettled([
        create(buyerId),
        create(otherBuyerId),
      ]);

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(reviews).toHaveLength(2);
    });
  });

  describe('canReview, hasReviewed y reviewId (getReviewStatus)', () => {
    const status = (userId: string | undefined) =>
      service.getReviewStatus(
        {
          id: productId,
          type: products[0].type,
          seller: products[0].seller,
        },
        userId,
      );

    it('sin sesión: false, false y null', async () => {
      transactions.push(purchase(TransactionStatus.COMPLETED));
      await expect(status(undefined)).resolves.toEqual({
        canReview: false,
        hasReviewed: false,
        reviewId: null,
      });
    });

    it('autenticado sin compra: false, false y null', async () => {
      await expect(status(buyerId)).resolves.toEqual({
        canReview: false,
        hasReviewed: false,
        reviewId: null,
      });
    });

    it.each([TransactionStatus.FAILED, TransactionStatus.PENDING])(
      'con un pago %s: canReview false',
      async (paymentStatus) => {
        transactions.push(purchase(paymentStatus));
        await expect(status(buyerId)).resolves.toMatchObject({
          canReview: false,
        });
      },
    );

    it('con compra completed y sin reseña: canReview true', async () => {
      transactions.push(purchase(TransactionStatus.COMPLETED));
      await expect(status(buyerId)).resolves.toEqual({
        canReview: true,
        hasReviewed: false,
        reviewId: null,
      });
    });

    it('con compra y reseña propia: canReview false, hasReviewed true y reviewId', async () => {
      transactions.push(purchase(TransactionStatus.COMPLETED));
      const created = await create();

      await expect(status(buyerId)).resolves.toEqual({
        canReview: false,
        hasReviewed: true,
        reviewId: created.id,
      });
    });

    it('el vendedor: canReview false', async () => {
      await expect(status(ownerId)).resolves.toMatchObject({
        canReview: false,
        hasReviewed: false,
      });
    });

    it('producto de intercambio: canReview false aunque haya compra', async () => {
      products = [aProduct({ type: ProductType.EXCHANGE })];
      transactions.push(purchase(TransactionStatus.COMPLETED));
      await expect(status(buyerId)).resolves.toMatchObject({
        canReview: false,
      });
    });
  });

  describe('producto agotado, borrado o en borrador', () => {
    it('agotado (sold) con compra completed: se puede reseñar', async () => {
      products = [aProduct({ status: ProductStatus.SOLD })];
      transactions.push(purchase(TransactionStatus.COMPLETED));

      await expect(create()).resolves.toBeDefined();
    });

    describe('borrado (soft delete)', () => {
      beforeEach(() => {
        products = [aProduct({ deletedAt: new Date('2026-10-20') })];
      });

      it('con compra completed: puede reseñarlo y ver sus reseñas', async () => {
        transactions.push(purchase(TransactionStatus.COMPLETED));

        await expect(create()).resolves.toBeDefined();
        await expect(
          service.findByProduct(productId, { page: 1, limit: 10 }, buyerId),
        ).resolves.toMatchObject({ reviewsCount: 1 });
      });

      it('sin compra: 404 al reseñar y al listar', async () => {
        await expect(create()).rejects.toBeInstanceOf(NotFoundException);
        await expect(
          service.findByProduct(productId, { page: 1, limit: 10 }, buyerId),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('sin sesión: 404 al listar', async () => {
        await expect(
          service.findByProduct(productId, { page: 1, limit: 10 }, undefined),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('con un pago que no es completed: sigue siendo 404', async () => {
        transactions.push(purchase(TransactionStatus.FAILED));
        await expect(create()).rejects.toBeInstanceOf(NotFoundException);
      });
    });

    describe('borrador', () => {
      beforeEach(() => {
        products = [aProduct({ status: ProductStatus.DRAFT })];
      });

      it('GET reviews responde 404 a un usuario ajeno o sin sesión', async () => {
        await expect(
          service.findByProduct(productId, { page: 1, limit: 10 }, buyerId),
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(
          service.findByProduct(productId, { page: 1, limit: 10 }, undefined),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('el dueño sí puede consultarlo', async () => {
        await expect(
          service.findByProduct(productId, { page: 1, limit: 10 }, ownerId),
        ).resolves.toMatchObject({ reviewsCount: 0 });
      });
    });
  });

  describe('reembolso con reseña existente', () => {
    it('la reseña se conserva y canReview pasa a false', async () => {
      const completed = purchase(TransactionStatus.COMPLETED);
      transactions.push(completed);
      const created = await create();

      // El pago se reembolsa después.
      completed.status = TransactionStatus.REFUNDED;

      expect(reviews).toHaveLength(1);
      await expect(
        service.getReviewStatus(
          { id: productId, type: ProductType.SALE, seller: products[0].seller },
          buyerId,
        ),
      ).resolves.toEqual({
        canReview: false,
        hasReviewed: true,
        reviewId: created.id,
      });
      // Y la reseña propia sigue siendo editable.
      await expect(
        service.updateMine(productId, buyerId, { rating: 4 }),
      ).resolves.toMatchObject({ rating: 4 });
    });

    it('si hay otra compra completed del mismo producto, el reembolso no quita canReview', async () => {
      transactions.push(
        purchase(TransactionStatus.REFUNDED),
        purchase(TransactionStatus.COMPLETED),
      );

      await expect(
        service.getReviewStatus(
          { id: productId, type: ProductType.SALE, seller: products[0].seller },
          buyerId,
        ),
      ).resolves.toMatchObject({ canReview: true });
    });
  });

  describe('promedio y conteo', () => {
    it('se actualizan al crear, editar y borrar', async () => {
      transactions.push(
        purchase(TransactionStatus.COMPLETED),
        purchase(TransactionStatus.COMPLETED, otherBuyerId),
      );

      await expect(service.getProductRating(productId)).resolves.toEqual({
        ratingAverage: null,
        reviewsCount: 0,
      });

      await create(buyerId, 5);
      await expect(service.getProductRating(productId)).resolves.toEqual({
        ratingAverage: 5,
        reviewsCount: 1,
      });

      await create(otherBuyerId, 2);
      await expect(service.getProductRating(productId)).resolves.toEqual({
        ratingAverage: 3.5,
        reviewsCount: 2,
      });

      await service.updateMine(productId, otherBuyerId, { rating: 4 });
      await expect(service.getProductRating(productId)).resolves.toEqual({
        ratingAverage: 4.5,
        reviewsCount: 2,
      });

      await service.removeMine(productId, buyerId);
      await expect(service.getProductRating(productId)).resolves.toEqual({
        ratingAverage: 4,
        reviewsCount: 1,
      });
    });

    it('al borrar su reseña el usuario vuelve a poder reseñar', async () => {
      transactions.push(purchase(TransactionStatus.COMPLETED));
      await create();
      await service.removeMine(productId, buyerId);

      await expect(
        service.getReviewStatus(
          { id: productId, type: ProductType.SALE, seller: products[0].seller },
          buyerId,
        ),
      ).resolves.toMatchObject({ canReview: true, hasReviewed: false });
    });
  });

  describe('comentario y paginación', () => {
    it('un comentario de solo espacios llega como null y se guarda null', async () => {
      const dto = plainToInstance(CreateReviewDto, {
        rating: 5,
        comment: '   ',
      });
      expect(dto.comment).toBeNull();
      expect(await validate(dto)).toHaveLength(0);

      transactions.push(purchase(TransactionStatus.COMPLETED));
      await expect(
        service.create(productId, buyerId, dto),
      ).resolves.toMatchObject({ comment: null });
    });

    it('PATCH con comment null limpia el comentario; omitirlo lo conserva', async () => {
      transactions.push(purchase(TransactionStatus.COMPLETED));
      await service.create(productId, buyerId, {
        rating: 5,
        comment: 'Muy bueno',
      });

      await expect(
        service.updateMine(productId, buyerId, { rating: 4 }),
      ).resolves.toMatchObject({ comment: 'Muy bueno' });

      const cleared = plainToInstance(UpdateReviewDto, { comment: null });
      expect(cleared.comment).toBeNull();
      await expect(
        service.updateMine(productId, buyerId, cleared),
      ).resolves.toMatchObject({ comment: null });
    });

    it('PATCH vacío sigue siendo 400', async () => {
      transactions.push(purchase(TransactionStatus.COMPLETED));
      await create();
      await expect(service.updateMine(productId, buyerId, {})).rejects.toThrow(
        'Debe proporcionar rating o comment',
      );
    });

    it('rating fuera de 1-5 o decimal no valida', async () => {
      for (const rating of [0, 6, 4.5, 'x']) {
        const errors = await validate(
          plainToInstance(CreateReviewDto, { rating }),
        );
        expect(errors.map((e) => e.property)).toContain('rating');
      }
    });

    it('totalPages es 1 cuando no hay reseñas', async () => {
      await expect(
        service.findByProduct(productId, { page: 1, limit: 10 }, buyerId),
      ).resolves.toMatchObject({
        pagination: { total: 0, totalPages: 1 },
      });
    });

    it('cada autor de la página trae isPro y su marco, resueltos en una sola llamada al cargador', async () => {
      for (const id of ['a', 'b', 'c']) {
        transactions.push(purchase(TransactionStatus.COMPLETED, id));
        await create(id, 5);
      }
      cosmeticsService.getEffectiveSummaryForUsers.mockClear();
      cosmeticsService.getEffectiveSummaryForUsers.mockResolvedValue(
        new Map([
          [
            'a',
            {
              isPro: true,
              frame: { code: 'frame_gold', assetUrl: 'https://cdn/gold.png' },
            },
          ],
          [
            'b',
            {
              isPro: false,
              frame: { code: 'frame_simple', assetUrl: null },
            },
          ],
        ]),
      );

      const page = await service.findByProduct(
        productId,
        { page: 1, limit: 10 },
        undefined,
      );

      // 'c' no aparece en el cargador: se pinta sin Pro y sin marco propio.
      expect(
        Object.fromEntries(
          page.data.map((review) => [
            review.author.id,
            [review.author.isPro, review.author.frame.code],
          ]),
        ),
      ).toEqual({
        a: [true, 'frame_gold'],
        b: [false, 'frame_simple'],
        c: [false, 'frame_default'],
      });
      expect(
        cosmeticsService.getEffectiveSummaryForUsers,
      ).toHaveBeenCalledTimes(1);
      expect(cosmeticsService.getEffectiveSummaryForUsers).toHaveBeenCalledWith(
        ['c', 'b', 'a'],
      );
    });

    it('crear y editar devuelven la reseña con isPro y frame del autor', async () => {
      transactions.push(purchase(TransactionStatus.COMPLETED));
      cosmeticsService.getEffectiveSummaryForUsers.mockResolvedValue(
        new Map([
          [
            buyerId,
            {
              isPro: true,
              frame: { code: 'frame_neon', assetUrl: null },
            },
          ],
        ]),
      );

      const created = await create(buyerId, 4);
      const updated = await service.updateMine(productId, buyerId, {
        rating: 5,
      });

      for (const review of [created, updated]) {
        expect(review.author).toMatchObject({
          id: buyerId,
          isPro: true,
          frame: { code: 'frame_neon' },
        });
      }
    });

    it('lista las más recientes primero y pagina', async () => {
      for (const id of ['a', 'b', 'c']) {
        transactions.push(purchase(TransactionStatus.COMPLETED, id));
        await create(id, 5);
      }

      const page = await service.findByProduct(
        productId,
        { page: 1, limit: 2 },
        undefined,
      );
      expect(page.data.map((review) => review.author.id)).toEqual(['c', 'b']);
      expect(page.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    });
  });
});
