import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BADGE_CODES } from '../badges/badges.config';
import { escapeLike } from '../common/escape-like';
import { unaccentSql } from '../common/unaccent-sql';
import { UserBadge } from '../badges/entities/user-badge.entity';
import { isValidIntId } from '../conversations/dto/int-id';
import {
  Paginated,
  ProductListItem,
  ProductsService,
} from '../products/products.service';
import { ProStatusService } from '../pro-status/pro-status.service';
import { ResponseTimeService } from '../response-time/response-time.service';
import { Seller } from '../sellers/entities/seller.entity';
import { UsersService } from '../users/users.service';
import { GetSellerProductsQueryDto } from './dto/get-seller-products-query.dto';
import {
  SellerStoreDto,
  SellerTagDto,
  StoreSearchItemDto,
} from './dto/seller-store.dto';

/**
 * Tienda pública de un vendedor. Solo existe para vendedores aprobados
 * (is_verified) con cuenta activa: el registro seller se crea al solicitar,
 * así que un pendiente o rechazado responde 404 igual que uno inexistente.
 */
@Injectable()
export class SellersPublicService {
  constructor(
    @InjectRepository(Seller)
    private readonly sellerRepository: Repository<Seller>,
    @InjectRepository(UserBadge)
    private readonly userBadgeRepository: Repository<UserBadge>,
    private readonly usersService: UsersService,
    private readonly productsService: ProductsService,
    private readonly responseTimeService: ResponseTimeService,
    private readonly proStatusService: ProStatusService,
  ) {}

  async getStore(sellerId: number): Promise<SellerStoreDto> {
    const seller = await this.findPublicSeller(sellerId);
    const [ratings, productCounts, sellerSince, responseTime, isPro] =
      await Promise.all([
        this.usersService.getSellerRatings([seller.sellerId]),
        this.productsService.countPublicBySeller([seller.sellerId]),
        this.getSellerSince(seller),
        this.responseTimeService.getForUser(seller.userId),
        this.proStatusService.isPro(seller.userId),
      ]);
    const rating = ratings.get(seller.sellerId);

    return {
      sellerId: seller.sellerId,
      userId: seller.userId,
      displayName: seller.displayName,
      description: seller.description,
      location: this.storeLocation(seller),
      photoUrl: seller.user.photoUrl ?? null,
      bannerUrl: null,
      isVerified: seller.isVerified,
      isPro,
      ratingAverage: rating?.ratingAverage ?? null,
      reviewsCount: rating?.reviewsCount ?? 0,
      completedSalesCount: seller.completedSalesCount,
      activeProductsCount: productCounts.get(seller.sellerId) ?? 0,
      sellerSince,
      responseTime,
    };
  }

  async getTags(sellerId: number): Promise<SellerTagDto[]> {
    await this.findPublicSeller(sellerId);
    return this.productsService.findSellerTags(sellerId);
  }

  // Misma query y forma que GET /products, limitada al vendedor y sin
  // comunidades privadas (mismo criterio que GET /users/:id/products).
  async findProducts(
    sellerId: number,
    query: GetSellerProductsQueryDto,
    viewerId: string | undefined,
    displayCurrency: string,
  ): Promise<Paginated<ProductListItem>> {
    await this.findPublicSeller(sellerId);
    return this.productsService.findAll(
      {
        tag: query.tag,
        type: query.type,
        condition: query.condition,
        status: query.status,
        priceMin: query.priceMin,
        priceMax: query.priceMax,
        sort: query.sort,
        page: query.page,
        limit: query.limit,
        sellerId,
        publicCommunitiesOnly: true,
      },
      viewerId,
      displayCurrency,
    );
  }

  // GET /search?type=stores: nombre o descripción de la tienda, sin
  // distinguir mayúsculas ni tildes. Solo vendedores aprobados con cuenta
  // activa, por nombre.
  async searchStores(
    q: string,
    page: number,
    limit: number,
  ): Promise<Paginated<StoreSearchItemDto>> {
    const text = `%${escapeLike(q)}%`;
    const [sellers, total] = await this.sellerRepository
      .createQueryBuilder('seller')
      .innerJoinAndSelect('seller.user', 'user')
      .where('seller.is_verified = true')
      .andWhere('user.is_active = true')
      .andWhere(
        `(${unaccentSql('seller.display_name')} ILIKE ${unaccentSql(':text')} OR ${unaccentSql('seller.description')} ILIKE ${unaccentSql(':text')})`,
        { text },
      )
      .orderBy('seller.displayName', 'ASC')
      .addOrderBy('seller.sellerId', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const sellerIds = sellers.map((seller) => seller.sellerId);
    const [ratings, productCounts, proUserIds] = await Promise.all([
      this.usersService.getSellerRatings(sellerIds),
      this.productsService.countPublicBySeller(sellerIds),
      this.proStatusService.proUserIds(sellers.map((seller) => seller.userId)),
    ]);

    return {
      data: sellers.map((seller) => {
        const rating = ratings.get(seller.sellerId);
        return {
          sellerId: seller.sellerId,
          userId: seller.userId,
          displayName: seller.displayName,
          photoUrl: seller.user.photoUrl ?? null,
          location: this.storeLocation(seller),
          isVerified: seller.isVerified,
          isPro: proUserIds.has(seller.userId),
          ratingAverage: rating?.ratingAverage ?? null,
          reviewsCount: rating?.reviewsCount ?? 0,
          activeProductsCount: productCounts.get(seller.sellerId) ?? 0,
        };
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // La de la tienda; si está vacía, la del perfil del usuario.
  private storeLocation(seller: Seller): string | null {
    return seller.location?.trim()
      ? seller.location
      : (seller.user.location ?? null);
  }

  // Un id fuera de int4 no puede existir: 404 sin consultar (evita el 500
  // de Postgres).
  async findPublicSeller(sellerId: number): Promise<Seller> {
    const seller = isValidIntId(sellerId)
      ? await this.sellerRepository.findOne({
          where: { sellerId, isVerified: true, user: { isActive: true } },
          relations: { user: true },
        })
      : null;
    if (!seller) throw new NotFoundException('Tienda no encontrada');
    return seller;
  }

  // approved_at; si no se registró (aprobados antes de la columna), la fecha
  // del badge verified_seller; si tampoco hay, null.
  private async getSellerSince(seller: Seller): Promise<Date | null> {
    if (seller.approvedAt) return seller.approvedAt;
    const badge = await this.userBadgeRepository.findOne({
      where: {
        userId: seller.userId,
        badge: { code: BADGE_CODES.VERIFIED_SELLER },
      },
      select: { id: true, awardedAt: true },
    });
    return badge?.awardedAt ?? null;
  }
}
