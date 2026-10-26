import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadgesService } from '../badges/badges.service';
import { ProStatusService } from '../pro-status/pro-status.service';
import { Seller } from '../sellers/entities/seller.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import {
  RatingDistributionDto,
  UserReputationDto,
} from './dto/user-reputation.dto';

@Injectable()
export class ReputationService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Seller)
    private readonly sellersRepository: Repository<Seller>,
    private readonly usersService: UsersService,
    private readonly badgesService: BadgesService,
    private readonly proStatusService: ProStatusService,
  ) {}

  // Reputación pública de un usuario. Las cuentas desactivadas se tratan como
  // inexistentes, igual que en el perfil público.
  async getUserReputation(userId: string): Promise<UserReputationDto> {
    const exists = await this.usersRepository.existsBy({
      id: userId,
      isActive: true,
    });
    if (!exists) throw new NotFoundException('Usuario no encontrado');

    const [seller, badges, isPro] = await Promise.all([
      // Un solicitante pendiente o rechazado responde como usuario sin tienda.
      this.sellersRepository.findOne({
        where: { userId, isVerified: true },
        select: { sellerId: true, completedSalesCount: true },
      }),
      this.badgesService.findUserBadges(userId),
      this.proStatusService.isPro(userId),
    ]);

    if (!seller) {
      return {
        userId,
        isSeller: false,
        isPro,
        ratingAverage: null,
        reviewsCount: 0,
        completedSalesCount: 0,
        ratingDistribution: this.emptyDistribution(),
        badges,
      };
    }

    const [ratings, ratingDistribution] = await Promise.all([
      this.usersService.getSellerRatings([seller.sellerId]),
      this.getRatingDistribution(seller.sellerId),
    ]);
    const rating = ratings.get(seller.sellerId);

    return {
      userId,
      isSeller: true,
      isPro,
      ratingAverage: rating?.ratingAverage ?? null,
      reviewsCount: rating?.reviewsCount ?? 0,
      completedSalesCount: seller.completedSalesCount,
      ratingDistribution,
      badges,
    };
  }

  // Reseñas por estrellas de todos los productos del vendedor, con el mismo
  // alcance que el rating (UsersService, productos borrados incluidos).
  private async getRatingDistribution(
    sellerId: number,
  ): Promise<RatingDistributionDto> {
    const counts =
      await this.usersService.getSellerRatingDistribution(sellerId);

    const distribution = this.emptyDistribution();
    for (const [rating, count] of counts) {
      const stars = String(rating) as keyof RatingDistributionDto;
      if (stars in distribution) distribution[stars] = count;
    }
    return distribution;
  }

  private emptyDistribution(): RatingDistributionDto {
    return { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  }
}
