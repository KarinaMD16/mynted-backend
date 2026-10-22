import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { PaymentTransaction } from '../payments/entities/payment-transaction.entity';
import { TransactionStatus } from '../payments/enums/transaction-status.enum';
import { Product, ProductType } from './entities/product.entity';
import { Review } from './entities/review.entity';
import { ReviewIneligibility, ReviewsService } from './reviews.service';

describe('ReviewsService', () => {
  const productId = 22;
  const buyerId = 'buyer-id';
  const ownerId = 'owner-id';

  let service: ReviewsService;
  let reviewRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOneOrFail: jest.Mock;
    existsBy: jest.Mock;
  };
  let productRepository: { findOne: jest.Mock };
  let transactionRepository: { existsBy: jest.Mock };

  const product = (type = ProductType.SALE) => ({
    id: productId,
    type,
    seller: { sellerId: 7, userId: ownerId },
  });

  // Estado de la base para un caso: tipo de producto, compra completada y
  // reseña previa del usuario.
  const givenState = (state: {
    type?: ProductType;
    purchased?: boolean;
    reviewed?: boolean;
  }) => {
    productRepository.findOne.mockResolvedValue(product(state.type));
    transactionRepository.existsBy.mockResolvedValue(state.purchased ?? true);
    reviewRepository.existsBy.mockResolvedValue(state.reviewed ?? false);
  };

  beforeEach(() => {
    reviewRepository = {
      create: jest.fn((data: Partial<Review>) => data),
      save: jest.fn((review: Partial<Review>) =>
        Promise.resolve({ ...review, id: 1 }),
      ),
      findOneOrFail: jest.fn().mockResolvedValue({
        id: 1,
        productId,
        authorId: buyerId,
        rating: 5,
        comment: 'Excelente',
        createdAt: new Date('2026-10-20T10:00:00Z'),
        updatedAt: new Date('2026-10-20T10:00:00Z'),
        author: { id: buyerId, username: 'comprador', photoUrl: null },
      }),
      existsBy: jest.fn(),
    };
    productRepository = { findOne: jest.fn() };
    transactionRepository = { existsBy: jest.fn() };
    givenState({});

    service = new ReviewsService(
      reviewRepository as unknown as Repository<Review>,
      productRepository as unknown as Repository<Product>,
      transactionRepository as unknown as Repository<PaymentTransaction>,
    );
  });

  describe('create (POST /products/:id/reviews)', () => {
    it('404 si el producto no existe, antes que cualquier otra regla', async () => {
      productRepository.findOne.mockResolvedValue(null);

      await expect(
        service.create(productId, ownerId, { rating: 5 }),
      ).rejects.toThrow(NotFoundException);
      expect(transactionRepository.existsBy).not.toHaveBeenCalled();
    });

    it('403 al dueño del producto sin consultar compras', async () => {
      await expect(
        service.create(productId, ownerId, { rating: 5 }),
      ).rejects.toThrow(
        new ForbiddenException('No puedes reseñar tu propio producto'),
      );
      expect(transactionRepository.existsBy).not.toHaveBeenCalled();
      expect(reviewRepository.save).not.toHaveBeenCalled();
    });

    it('403 si el usuario no tiene una compra completada', async () => {
      givenState({ purchased: false });

      await expect(
        service.create(productId, buyerId, { rating: 5 }),
      ).rejects.toThrow(
        new ForbiddenException(
          'Solo puedes reseñar productos que hayas comprado',
        ),
      );
      expect(transactionRepository.existsBy).toHaveBeenCalledWith({
        productId,
        buyerId,
        status: TransactionStatus.COMPLETED,
      });
      expect(reviewRepository.save).not.toHaveBeenCalled();
    });

    it('403 sin compra aunque ya exista una reseña (el 403 va antes que el 409)', async () => {
      givenState({ purchased: false, reviewed: true });

      await expect(
        service.create(productId, buyerId, { rating: 5 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('403 para productos de intercambio', async () => {
      givenState({ type: ProductType.EXCHANGE });

      await expect(
        service.create(productId, buyerId, { rating: 5 }),
      ).rejects.toThrow(
        new ForbiddenException(
          'Los productos de intercambio todavía no se pueden reseñar',
        ),
      );
      expect(transactionRepository.existsBy).not.toHaveBeenCalled();
    });

    it('crea la reseña si existe una compra completada', async () => {
      const result = await service.create(productId, buyerId, {
        rating: 5,
        comment: 'Excelente',
      });

      expect(reviewRepository.create).toHaveBeenCalledWith({
        productId,
        authorId: buyerId,
        rating: 5,
        comment: 'Excelente',
      });
      expect(result).toMatchObject({
        id: 1,
        productId,
        rating: 5,
        comment: 'Excelente',
        author: { id: buyerId, username: 'comprador', photoUrl: null },
        isMine: true,
      });
    });

    it('409 si ya reseñó el producto, sin intentar insertar', async () => {
      givenState({ reviewed: true });

      await expect(
        service.create(productId, buyerId, { rating: 4 }),
      ).rejects.toThrow(new ConflictException('Ya reseñaste este producto'));
      expect(reviewRepository.save).not.toHaveBeenCalled();
    });

    it('409 si dos POST simultáneos chocan en el índice único', async () => {
      reviewRepository.save.mockRejectedValue(
        new QueryFailedError(
          'INSERT INTO review',
          [],
          Object.assign(new Error('duplicate key'), { code: '23505' }),
        ),
      );

      await expect(
        service.create(productId, buyerId, { rating: 4 }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('canUserReview (canComment de GET /products/:id)', () => {
    it('sin sesión siempre es false y no consulta nada', async () => {
      await expect(service.canUserReview(product(), undefined)).resolves.toBe(
        false,
      );
      expect(transactionRepository.existsBy).not.toHaveBeenCalled();
      expect(reviewRepository.existsBy).not.toHaveBeenCalled();
    });

    it('el dueño no puede comentar', async () => {
      await expect(service.canUserReview(product(), ownerId)).resolves.toBe(
        false,
      );
    });

    it('sin compra completada no puede comentar', async () => {
      givenState({ purchased: false });
      await expect(service.canUserReview(product(), buyerId)).resolves.toBe(
        false,
      );
    });

    it('con compra completada y sin reseña puede comentar', async () => {
      await expect(service.canUserReview(product(), buyerId)).resolves.toBe(
        true,
      );
      expect(reviewRepository.existsBy).toHaveBeenCalledWith({
        productId,
        authorId: buyerId,
      });
    });

    it('con compra y reseña previa ya no puede comentar', async () => {
      givenState({ reviewed: true });
      await expect(service.canUserReview(product(), buyerId)).resolves.toBe(
        false,
      );
    });

    it('un producto de intercambio nunca se puede comentar', async () => {
      givenState({ type: ProductType.EXCHANGE });
      await expect(
        service.canUserReview(product(ProductType.EXCHANGE), buyerId),
      ).resolves.toBe(false);
    });
  });

  // Misma tabla para los dos: POST crea la reseña exactamente cuando
  // canComment es true, y en los demás casos responde el error del motivo.
  describe('POST y canComment coinciden', () => {
    const cases: {
      name: string;
      userId: string;
      type?: ProductType;
      purchased?: boolean;
      reviewed?: boolean;
      expected: ReviewIneligibility | null;
      error?: new (...args: never[]) => Error;
    }[] = [
      {
        name: 'dueño',
        userId: ownerId,
        expected: ReviewIneligibility.OWN_PRODUCT,
        error: ForbiddenException,
      },
      {
        name: 'intercambio',
        userId: buyerId,
        type: ProductType.EXCHANGE,
        expected: ReviewIneligibility.EXCHANGE_PRODUCT,
        error: ForbiddenException,
      },
      {
        name: 'sin compra',
        userId: buyerId,
        purchased: false,
        expected: ReviewIneligibility.NOT_PURCHASED,
        error: ForbiddenException,
      },
      {
        name: 'con compra y reseña previa',
        userId: buyerId,
        reviewed: true,
        expected: ReviewIneligibility.ALREADY_REVIEWED,
        error: ConflictException,
      },
      { name: 'con compra', userId: buyerId, expected: null },
    ];

    it.each(cases)('$name', async (testCase) => {
      givenState(testCase);
      const target = product(testCase.type);

      await expect(
        service.getReviewIneligibility(target, testCase.userId),
      ).resolves.toBe(testCase.expected);

      const canComment = await service.canUserReview(target, testCase.userId);
      const post = service.create(productId, testCase.userId, { rating: 5 });

      expect(canComment).toBe(testCase.expected === null);
      if (canComment) {
        await expect(post).resolves.toMatchObject({ id: 1 });
      } else {
        await expect(post).rejects.toThrow(testCase.error);
      }
    });
  });
});
