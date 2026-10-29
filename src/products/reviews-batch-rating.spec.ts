import { Repository } from 'typeorm';
import { PaymentTransaction } from '../payments/entities/payment-transaction.entity';
import { CosmeticsService } from '../cosmetics/cosmetics.service';
import { Product } from './entities/product.entity';
import { Review } from './entities/review.entity';
import { ReviewsService } from './reviews.service';

interface RawRow {
  productId: number | string;
  average: string | null;
  count: string;
}

describe('ReviewsService.getProductRatings', () => {
  let service: ReviewsService;
  let rows: RawRow[];
  let createQueryBuilder: jest.Mock;
  let where: jest.Mock;

  beforeEach(() => {
    rows = [];
    where = jest.fn();
    const builder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: where.mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(() => Promise.resolve(rows)),
    };
    createQueryBuilder = jest.fn(() => builder);

    service = new ReviewsService(
      { createQueryBuilder } as unknown as Repository<Review>,
      {} as Repository<Product>,
      {} as Repository<PaymentTransaction>,
      {} as CosmeticsService,
    );
  });

  it('un producto sin reseñas queda en null y 0', async () => {
    const ratings = await service.getProductRatings([7]);

    expect(ratings.get(7)).toEqual({ ratingAverage: null, reviewsCount: 0 });
  });

  it('varios productos con y sin reseñas, con el promedio ya redondeado', async () => {
    rows = [
      { productId: 1, average: '4.5', count: '2' },
      { productId: '2', average: '3.7', count: '3' },
    ];

    const ratings = await service.getProductRatings([1, 2, 3]);

    expect(ratings.get(1)).toEqual({ ratingAverage: 4.5, reviewsCount: 2 });
    expect(ratings.get(2)).toEqual({ ratingAverage: 3.7, reviewsCount: 3 });
    expect(ratings.get(3)).toEqual({ ratingAverage: null, reviewsCount: 0 });
  });

  it('ignora ids repetidos y los consulta una sola vez', async () => {
    rows = [{ productId: 1, average: '5.0', count: '1' }];

    const ratings = await service.getProductRatings([1, 1, 2, 1, 2]);

    expect([...ratings.keys()]).toEqual([1, 2]);
    expect(where).toHaveBeenCalledWith(expect.any(String), {
      productIds: [1, 2],
    });
  });

  it('lista vacía: mapa vacío y ninguna consulta', async () => {
    const ratings = await service.getProductRatings([]);

    expect(ratings.size).toBe(0);
    expect(createQueryBuilder).not.toHaveBeenCalled();
  });

  it('hace una sola consulta sin importar cuántos productos pida', async () => {
    await service.getProductRatings([1, 2, 3, 4, 5, 6, 7, 8]);

    expect(createQueryBuilder).toHaveBeenCalledTimes(1);
  });

  it('getProductRating devuelve lo mismo que el lote para ese producto', async () => {
    rows = [{ productId: 9, average: '4.0', count: '4' }];

    await expect(service.getProductRating(9)).resolves.toEqual({
      ratingAverage: 4,
      reviewsCount: 4,
    });
  });
});
