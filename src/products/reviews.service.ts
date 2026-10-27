import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import {
  CreateReviewDto,
  GetReviewsQueryDto,
  UpdateReviewDto,
} from './dto/review.dto';
import { PaymentTransaction } from '../payments/entities/payment-transaction.entity';
import { TransactionStatus } from '../payments/enums/transaction-status.enum';
import { Product, ProductStatus, ProductType } from './entities/product.entity';
import { Review } from './entities/review.entity';
import { ReviewCreatedEvent, ReviewEvents } from './review-events';
import {
  NO_SESSION_REVIEW_STATUS,
  ReviewIneligibility,
  ReviewStatus,
  resolveReviewIneligibility,
} from './review-eligibility';

export { ReviewIneligibility };

export interface RatingSummary {
  ratingAverage: number | null;
  reviewsCount: number;
}

interface PostgresError {
  code?: string;
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
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  // Orden: 404 producto, 403 dueño, 403 intercambio, 403 sin compra, 409
  // duplicado.
  async create(productId: number, userId: string, dto: CreateReviewDto) {
    const product = await this.getReviewableProduct(productId, userId);

    const { ineligibility } = await this.getReviewState(product, userId);
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
      const event: ReviewCreatedEvent = {
        reviewId: review.id,
        productId,
        authorId: userId,
        sellerUserId: product.seller.userId,
        rating: review.rating,
      };
      this.eventEmitter?.emit(ReviewEvents.CREATED, event);
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

  // Regla única para reseñar (create y canReview la comparten): no ser el
  // dueño, que el producto no sea de intercambio (aún no hay flujo para
  // ellos), tener una compra completada y no haberlo reseñado. Devuelve además
  // hasReviewed y reviewId (reseña propia, si existe). La compra solo se
  // consulta si hace falta; ambas son consultas exists/select mínimas.
  async getReviewState(
    product: ReviewTarget,
    userId: string,
  ): Promise<
    ReviewStatus & {
      ineligibility: ReviewIneligibility | null;
    }
  > {
    const isOwner = product.seller.userId === userId;
    const isExchange = product.type === ProductType.EXCHANGE;

    const [purchased, review] = await Promise.all([
      isOwner || isExchange
        ? Promise.resolve(false)
        : this.hasCompletedPurchase(product.id, userId),
      this.reviewRepository.findOne({
        where: { productId: product.id, authorId: userId },
        select: { id: true },
      }),
    ]);

    const ineligibility = resolveReviewIneligibility({
      isOwner,
      isExchange,
      purchased,
      hasReviewed: review !== null,
    });
    return {
      ineligibility,
      canReview: ineligibility === null,
      hasReviewed: review !== null,
      reviewId: review?.id ?? null,
    };
  }

  // canReview / hasReviewed / reviewId de GET /products/:id. Sin sesión:
  // false, false y null, sin consultar nada.
  async getReviewStatus(
    product: ReviewTarget,
    viewerId: string | undefined,
  ): Promise<ReviewStatus> {
    if (!viewerId) return NO_SESSION_REVIEW_STATUS;
    const { canReview, hasReviewed, reviewId } = await this.getReviewState(
      product,
      viewerId,
    );
    return { canReview, hasReviewed, reviewId };
  }

  // Solo cuentan pagos completados: pending, failed y refunded no habilitan
  // una reseña nueva (una reseña ya hecha sí se conserva tras un reembolso).
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
    await this.getReviewableProduct(productId, viewerId);

    const [reviews, total] = await this.reviewRepository.findAndCount({
      where: { productId },
      withDeleted: true,
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
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
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

  // Producto sobre el que se reseña o se listan reseñas.
  // - Un borrador solo existe para su dueño (404 para los demás).
  // - Un producto borrado (soft delete) sigue disponible, para reseñar y ver
  //   sus reseñas, solo para quien tiene una compra completada de él; sin
  //   compra o sin sesión es 404.
  // - Agotado (sold) no se restringe: justamente lo compraron.
  private async getReviewableProduct(
    productId: number,
    viewerId?: string,
  ): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id: productId },
      withDeleted: true,
      relations: { seller: true },
      select: {
        id: true,
        status: true,
        type: true,
        deletedAt: true,
        seller: { sellerId: true, userId: true },
      },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');

    if (
      product.status === ProductStatus.DRAFT &&
      product.seller.userId !== viewerId
    ) {
      throw new NotFoundException('Producto no encontrado');
    }
    if (
      product.deletedAt &&
      !(viewerId && (await this.hasCompletedPurchase(product.id, viewerId)))
    ) {
      throw new NotFoundException('Producto no encontrado');
    }
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
      withDeleted: true,
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
