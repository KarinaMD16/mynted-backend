import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PriceDisplayService } from '../pricing/price-display.service';
import { UsersService } from '../users/users.service';
import { Product, ProductStatus, ProductType } from './entities/product.entity';
import { ProductsService } from './products.service';
import { ReviewsService } from './reviews.service';

describe('ProductsService.findDetail', () => {
  const ownerId = 'owner-id';
  const viewerId = 'viewer-id';

  let service: ProductsService;
  let productRepository: { findOne: jest.Mock };
  let favoriteRepository: { find: jest.Mock };
  let reviewsService: {
    getProductRating: jest.Mock;
    canUserReview: jest.Mock;
  };

  const product = {
    id: 22,
    title: 'Funko Pop Goku SSJ',
    price: 25000,
    discountPercent: null,
    currency: 'CRC',
    status: ProductStatus.ACTIVE,
    type: ProductType.SALE,
    seller: {
      sellerId: 7,
      displayName: 'Funko Corner',
      isVerified: true,
      userId: ownerId,
      user: { id: ownerId, photoUrl: 'https://cdn/a.png' },
    },
  } as unknown as Product;

  beforeEach(() => {
    productRepository = { findOne: jest.fn().mockResolvedValue(product) };
    favoriteRepository = { find: jest.fn().mockResolvedValue([]) };
    reviewsService = {
      getProductRating: jest
        .fn()
        .mockResolvedValue({ ratingAverage: 4.5, reviewsCount: 2 }),
      canUserReview: jest.fn().mockResolvedValue(true),
    };
    const usersService = {
      getSellerRatings: jest
        .fn()
        .mockResolvedValue(
          new Map([[7, { ratingAverage: 4.7, reviewsCount: 12 }]]),
        ),
    };
    const repo = {} as Repository<never>;

    service = new ProductsService(
      productRepository as unknown as Repository<Product>,
      repo,
      repo,
      repo,
      repo,
      repo,
      favoriteRepository as unknown as Repository<never>,
      repo,
      usersService as unknown as UsersService,
      reviewsService as unknown as ReviewsService,
      {} as never,
      {} as never,
      {} as PriceDisplayService,
    );
  });

  it('agrega seller.userId y canComment (a nivel de producto) con la regla de reseñas', async () => {
    const detail = await service.findDetail(22, viewerId);

    expect(reviewsService.canUserReview).toHaveBeenCalledWith(
      product,
      viewerId,
    );
    expect(detail.canComment).toBe(true);
    expect(detail.seller).toEqual({
      sellerId: 7,
      userId: ownerId,
      displayName: 'Funko Corner',
      isVerified: true,
      photoUrl: 'https://cdn/a.png',
      ratingAverage: 4.7,
      reviewsCount: 12,
    });
    expect(detail.seller).not.toHaveProperty('canComment');
  });

  it('pasa la sesión tal cual: sin sesión la regla recibe undefined', async () => {
    reviewsService.canUserReview.mockResolvedValue(false);

    const detail = await service.findDetail(22);

    expect(reviewsService.canUserReview).toHaveBeenCalledWith(
      product,
      undefined,
    );
    expect(detail.canComment).toBe(false);
  });

  it('un borrador ajeno sigue respondiendo 404 sin evaluar canComment', async () => {
    productRepository.findOne.mockResolvedValue({
      ...product,
      status: ProductStatus.DRAFT,
    });

    await expect(service.findDetail(22, viewerId)).rejects.toThrow(
      NotFoundException,
    );
    expect(reviewsService.canUserReview).not.toHaveBeenCalled();
  });
});
