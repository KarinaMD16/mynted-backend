import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import {
  CreateReviewDto,
  GetReviewsQueryDto,
  UpdateReviewDto,
} from './dto/review.dto';
import { PaymentTransaction } from '../payments/entities/payment-transaction.entity';
import { TransactionStatus } from '../payments/enums/transaction-status.enum';
import { Product, ProductType } from './entities/product.entity';
import { Review } from './entities/review.entity';

export interface RatingSummary {
  ratingAverage: number | null;
  reviewsCount: number;
}

interface PostgresError {
  code?: string;
}

// Por qué un usuario no puede reseñar un producto, en el orden en que se
// evalúa. Lo comparten POST /products/:id/reviews (como 403/409) y canComment
// de GET /products/:id, así nunca divergen.
export enum ReviewIneligibility {
  OWN_PRODUCT = 'own_product',
  EXCHANGE_PRODUCT = 'exchange_product',
  NOT_PURCHASED = 'not_purchased',
  ALREADY_REVIEWED = 'already_reviewed',
}

const INELIGIBILITY_ERRORS: Record<ReviewIneligibility, () => Error> = {
  [ReviewIneligibility.OWN_PRODUCT]: () =>
    new ForbiddenException('No puedes reseñar tu propio producto'),
  [ReviewIneligibility.EXCHANGE_PRODUCT]: () =>
    new ForbiddenException(
      'Los productos de intercambio todavía no se pueden reseñar',
    ),
  [ReviewIneligibility.NOT_PURCHASED]: () =>
    new ForbiddenException('Solo puedes reseñar productos que hayas comprado'),
  [ReviewIneligibility.ALREADY_REVIEWED]: () =>
    new ConflictException('Ya reseñaste este producto'),
};

// Lo mínimo del producto que necesita la regla.
export type ReviewTarget = Pick<Product, 'id' | 'type'> & {
  seller: Pick<Product['seller'], 'userId'>;
};

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(PaymentTransaction)
    private readonly transactionRepository: Repository<PaymentTransaction>,
  ) {}

  // Orden: 404 producto, 403 dueño, 403 intercambio, 403 sin compra, 409
  // duplicado.
  async create(productId: number, userId: string, dto: CreateReviewDto) {
    const product = await this.getReviewableProduct(productId);

    const ineligibility = await this.getReviewIneligibility(product, userId);
    if (ineligibility) throw INELIGIBILITY_ERRORS[ineligibility]();

    try {
      const review = await this.reviewRepository.save(
        this.reviewRepository.create({
          productId,
          authorId: userId,
          rating: dto.rating,
          comment: dto.comment ?? null,
        }),
      );
      return this.findOneMapped(review.id, userId);
    } catch (error: unknown) {
      // Dos POST simultáneos: el índice único decide.
      if (
        error instanceof QueryFailedError &&
        (error.driverError as PostgresError).code === '23505'
      ) {
        throw INELIGIBILITY_ERRORS[ReviewIneligibility.ALREADY_REVIEWED]();
      }
      throw error;
    }
  }

  // Regla única para reseñar: no ser el dueño, que el producto no sea de
  // intercambio (aún no hay flujo para ellos), tener una compra completada y
  // no haberlo reseñado. Solo usa consultas exists. null = puede reseñar.
  async getReviewIneligibility(
    product: ReviewTarget,
    userId: string,
  ): Promise<ReviewIneligibility | null> {
    if (product.seller.userId === userId) {
      return ReviewIneligibility.OWN_PRODUCT;
    }
    if (product.type === ProductType.EXCHANGE) {
      return ReviewIneligibility.EXCHANGE_PRODUCT;
    }

    const [purchased, reviewed] = await Promise.all([
      this.hasCompletedPurchase(product.id, userId),
      this.reviewRepository.existsBy({
        productId: product.id,
        authorId: userId,
      }),
    ]);
    if (!purchased) return ReviewIneligibility.NOT_PURCHASED;
    if (reviewed) return ReviewIneligibility.ALREADY_REVIEWED;
    return null;
  }

  // canComment de GET /products/:id. Sin sesión siempre false.
  async canUserReview(
    product: ReviewTarget,
    viewerId: string | undefined,
  ): Promise<boolean> {
    if (!viewerId) return false;
    return (await this.getReviewIneligibility(product, viewerId)) === null;
  }

  hasCompletedPurchase(productId: number, userId: string): Promise<boolean> {
    return this.transactionRepository.existsBy({
      productId,
      buyerId: userId,
      status: TransactionStatus.COMPLETED,
    });
  }

  async findByProduct(
    productId: number,
    query: GetReviewsQueryDto,
    viewerId: string | undefined,
  ) {
    await this.getReviewableProduct(productId);

    const [reviews, total] = await this.reviewRepository.findAndCount({
      where: { productId },
      relations: { author: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    const summary = await this.getProductRating(productId);

    return {
      ...summary,
      data: reviews.map((review) => this.toResponse(review, viewerId)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async updateMine(productId: number, userId: string, dto: UpdateReviewDto) {
    if (dto.rating === undefined && dto.comment === undefined) {
      throw new BadRequestException(
        'Debe proporcionar rating o comment para actualizar',
      );
    }
    const review = await this.getMine(productId, userId);
    if (dto.rating !== undefined) review.rating = dto.rating;
    if (dto.comment !== undefined) review.comment = dto.comment;
    await this.reviewRepository.save(review);
    return this.findOneMapped(review.id, userId);
  }

  async removeMine(productId: number, userId: string): Promise<void> {
    const review = await this.getMine(productId, userId);
    await this.reviewRepository.delete(review.id);
  }

  // Promedio redondeado a 1 decimal y cantidad, calculados con agregado.
  async getProductRating(productId: number): Promise<RatingSummary> {
    const row = await this.reviewRepository
      .createQueryBuilder('review')
      .select('ROUND(AVG(review.rating)::numeric, 1)', 'average')
      .addSelect('COUNT(*)', 'count')
      .where('review.product_id = :productId', { productId })
      .getRawOne<{ average: string | null; count: string }>();

    const count = Number(row?.count ?? 0);
    return {
      ratingAverage:
        count > 0 && row?.average != null ? parseFloat(row.average) : null,
      reviewsCount: count,
    };
  }

  private async getReviewableProduct(productId: number): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id: productId },
      relations: { seller: true },
      select: {
        id: true,
        status: true,
        type: true,
        seller: { sellerId: true, userId: true },
      },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  private async getMine(productId: number, userId: string): Promise<Review> {
    const review = await this.reviewRepository.findOne({
      where: { productId, authorId: userId },
    });
    if (!review) throw new NotFoundException('No has reseñado este producto');
    return review;
  }

  private async findOneMapped(id: number, viewerId: string) {
    const review = await this.reviewRepository.findOneOrFail({
      where: { id },
      relations: { author: true },
    });
    return this.toResponse(review, viewerId);
  }

  private toResponse(review: Review, viewerId: string | undefined) {
    return {
      id: review.id,
      productId: review.productId,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
      author: {
        id: review.author.id,
        username: review.author.username,
        photoUrl: review.author.photoUrl ?? null,
      },
      isMine: review.authorId === viewerId,
    };
  }
}
