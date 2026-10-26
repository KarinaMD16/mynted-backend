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
  let proStatusService: { isPro: jest.Mock };
  let dataSource: { query: jest.Mock };
  let reviewsService: {
    getProductRating: jest.Mock;
    getReviewStatus: jest.Mock;
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
      getReviewStatus: jest.fn().mockResolvedValue({
        canReview: true,
        hasReviewed: false,
        reviewId: null,
      }),
    };
    const usersService = {
      getSellerRatings: jest
        .fn()
        .mockResolvedValue(
          new Map([[7, { ratingAverage: 4.7, reviewsCount: 12 }]]),
        ),
    };
    proStatusService = { isPro: jest.fn().mockResolvedValue(false) };
    // ids de los destacados efectivos (ninguno por defecto)
    dataSource = { query: jest.fn().mockResolvedValue([]) };
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
      dataSource as never,
      {} as PriceDisplayService,
      proStatusService as never,
    );
  });

  it('agrega seller.userId y canComment (a nivel de producto) con la regla de reseñas', async () => {
    const detail = await service.findDetail(22, viewerId);

    expect(reviewsService.getReviewStatus).toHaveBeenCalledWith(
      product,
      viewerId,
    );
    expect(detail.canComment).toBe(true);
    expect(detail).toMatchObject({
      canReview: true,
      canComment: true,
      hasReviewed: false,
      reviewId: null,
    });
    expect(detail.seller).toEqual({
      sellerId: 7,
      userId: ownerId,
      displayName: 'Funko Corner',
      isVerified: true,
      photoUrl: 'https://cdn/a.png',
      isPro: false,
      ratingAverage: 4.7,
      reviewsCount: 12,
    });
    expect(detail.seller).not.toHaveProperty('canComment');
  });

  it('isFeatured es el destacado efectivo del producto (una sola consulta)', async () => {
    dataSource.query.mockResolvedValue([{ id: 22 }]);

    const featured = await service.findDetail(22, viewerId);

    expect(featured.isFeatured).toBe(true);
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect((dataSource.query.mock.calls as unknown[][])[0][1]).toEqual([[22]]);

    dataSource.query.mockResolvedValue([]);
    expect((await service.findDetail(22, viewerId)).isFeatured).toBe(false);
  });

  it('el detalle no expone la preferencia featuredAt', async () => {
    const detail = await service.findDetail(22, viewerId);

    expect(detail).not.toHaveProperty('featuredAt');
  });

  it('seller.isPro refleja el Pro vigente del dueño del producto', async () => {
    proStatusService.isPro.mockResolvedValue(true);

    const detail = await service.findDetail(22, viewerId);

    expect(proStatusService.isPro).toHaveBeenCalledWith(ownerId);
    expect(detail.seller.isPro).toBe(true);
  });

  it('pasa la sesión tal cual: sin sesión la regla recibe undefined', async () => {
    reviewsService.getReviewStatus.mockResolvedValue({
      canReview: false,
      hasReviewed: false,
      reviewId: null,
    });

    const detail = await service.findDetail(22);

    expect(reviewsService.getReviewStatus).toHaveBeenCalledWith(
      product,
      undefined,
    );
    expect(detail.canComment).toBe(false);
    expect(detail).toMatchObject({
      canReview: false,
      hasReviewed: false,
      reviewId: null,
    });
  });

  it('un borrador ajeno sigue respondiendo 404 sin evaluar canComment', async () => {
    productRepository.findOne.mockResolvedValue({
      ...product,
      status: ProductStatus.DRAFT,
    });

    await expect(service.findDetail(22, viewerId)).rejects.toThrow(
      NotFoundException,
    );
    expect(reviewsService.getReviewStatus).not.toHaveBeenCalled();
  });
});
