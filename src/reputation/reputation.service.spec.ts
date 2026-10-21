import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BadgesService } from '../badges/badges.service';
import { BadgeRarity, BadgeScope } from '../badges/entities/badge.entity';
import { Review } from '../products/entities/review.entity';
import { Seller } from '../sellers/entities/seller.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { ReputationService } from './reputation.service';

describe('ReputationService', () => {
  const userId = '6f1c2a9e-1b2c-4d3e-8f90-123456789abc';
  const badge = {
    code: 'verified_seller',
    name: 'Vendedor verificado',
    description: 'Su solicitud de vendedor fue aprobada.',
    scope: BadgeScope.USER,
    rarity: BadgeRarity.RARE,
    awardedAt: new Date('2026-10-01T12:00:00Z'),
    derived: false,
  };

  let service: ReputationService;
  let usersRepository: { existsBy: jest.Mock };
  let sellersRepository: { findOne: jest.Mock };
  let distributionQuery: Record<string, jest.Mock>;
  let reviewRepository: { createQueryBuilder: jest.Mock };
  let usersService: { getSellerRatings: jest.Mock };
  let badgesService: { findUserBadges: jest.Mock };

  beforeEach(() => {
    usersRepository = { existsBy: jest.fn().mockResolvedValue(true) };
    sellersRepository = {
      findOne: jest
        .fn()
        .mockResolvedValue({ sellerId: 7, completedSalesCount: 15 }),
    };
    distributionQuery = {};
    for (const method of [
      'select',
      'addSelect',
      'innerJoin',
      'where',
      'groupBy',
    ]) {
      distributionQuery[method] = jest.fn().mockReturnValue(distributionQuery);
    }
    distributionQuery.getRawMany = jest.fn().mockResolvedValue([]);
    reviewRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(distributionQuery),
    };
    usersService = { getSellerRatings: jest.fn().mockResolvedValue(new Map()) };
    badgesService = { findUserBadges: jest.fn().mockResolvedValue([badge]) };

    service = new ReputationService(
      usersRepository as unknown as Repository<User>,
      sellersRepository as unknown as Repository<Seller>,
      reviewRepository as unknown as Repository<Review>,
      usersService as unknown as UsersService,
      badgesService as unknown as BadgesService,
    );
  });

  it('devuelve promedio, total, distribución, ventas y badges de un vendedor con reseñas', async () => {
    usersService.getSellerRatings.mockResolvedValue(
      new Map([[7, { ratingAverage: 4.6, reviewsCount: 12 }]]),
    );
    distributionQuery.getRawMany.mockResolvedValue([
      { rating: 5, count: '8' },
      { rating: 4, count: '3' },
      { rating: 3, count: '1' },
    ]);

    await expect(service.getUserReputation(userId)).resolves.toEqual({
      userId,
      isSeller: true,
      ratingAverage: 4.6,
      reviewsCount: 12,
      completedSalesCount: 15,
      ratingDistribution: { '1': 0, '2': 0, '3': 1, '4': 3, '5': 8 },
      badges: [badge],
    });
    expect(usersService.getSellerRatings).toHaveBeenCalledWith([7]);
    expect(distributionQuery.where).toHaveBeenCalledWith(
      'product.seller_id = :sellerId',
      { sellerId: 7 },
    );
  });

  it('devuelve ratingAverage null y conteos en 0 si el vendedor no tiene reseñas', async () => {
    sellersRepository.findOne.mockResolvedValue({
      sellerId: 7,
      completedSalesCount: 2,
    });

    await expect(service.getUserReputation(userId)).resolves.toEqual({
      userId,
      isSeller: true,
      ratingAverage: null,
      reviewsCount: 0,
      completedSalesCount: 2,
      ratingDistribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
      badges: [badge],
    });
  });

  it('devuelve ceros e isSeller false si el usuario no es vendedor', async () => {
    sellersRepository.findOne.mockResolvedValue(null);
    badgesService.findUserBadges.mockResolvedValue([]);

    await expect(service.getUserReputation(userId)).resolves.toEqual({
      userId,
      isSeller: false,
      ratingAverage: null,
      reviewsCount: 0,
      completedSalesCount: 0,
      ratingDistribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
      badges: [],
    });
    expect(usersService.getSellerRatings).not.toHaveBeenCalled();
    expect(reviewRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('lanza 404 si el usuario no existe o está desactivado', async () => {
    usersRepository.existsBy.mockResolvedValue(false);

    await expect(service.getUserReputation(userId)).rejects.toThrow(
      new NotFoundException('Usuario no encontrado'),
    );
    expect(usersRepository.existsBy).toHaveBeenCalledWith({
      id: userId,
      isActive: true,
    });
    expect(sellersRepository.findOne).not.toHaveBeenCalled();
  });
});
