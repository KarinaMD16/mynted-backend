import { ConflictException, ForbiddenException } from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { PaymentTransaction } from '../payments/entities/payment-transaction.entity';
import { TransactionStatus } from '../payments/enums/transaction-status.enum';
import { Product } from './entities/product.entity';
import { Review } from './entities/review.entity';
import { ReviewsService } from './reviews.service';

describe('ReviewsService.create', () => {
  const productId = 22;
  const buyerId = 'buyer-id';
  const ownerId = 'owner-id';

  let service: ReviewsService;
  let reviewRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOneOrFail: jest.Mock;
  };
  let productRepository: { findOne: jest.Mock };
  let transactionRepository: { existsBy: jest.Mock };

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
    };
    productRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: productId,
        seller: { sellerId: 7, userId: ownerId },
      }),
    };
    transactionRepository = { existsBy: jest.fn().mockResolvedValue(true) };

    service = new ReviewsService(
      reviewRepository as unknown as Repository<Review>,
      productRepository as unknown as Repository<Product>,
      transactionRepository as unknown as Repository<PaymentTransaction>,
    );
  });

  it('rechaza con 403 si el usuario no tiene una compra completada', async () => {
    transactionRepository.existsBy.mockResolvedValue(false);

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

  it('rechaza con 409 si ya reseñó el producto', async () => {
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

  it('rechaza con 403 al dueño del producto sin consultar compras', async () => {
    await expect(
      service.create(productId, ownerId, { rating: 5 }),
    ).rejects.toThrow(
      new ForbiddenException('No puedes reseñar tu propio producto'),
    );
    expect(transactionRepository.existsBy).not.toHaveBeenCalled();
    expect(reviewRepository.save).not.toHaveBeenCalled();
  });
});
