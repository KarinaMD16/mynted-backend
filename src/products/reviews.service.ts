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
import { Product } from './entities/product.entity';
import { Review } from './entities/review.entity';

export interface RatingSummary {
  ratingAverage: number | null;
  reviewsCount: number;
}

interface PostgresError {
  code?: string;
}

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  async create(productId: number, userId: string, dto: CreateReviewDto) {
    const product = await this.getReviewableProduct(productId);

    if (product.seller.userId === userId) {
      throw new ForbiddenException('No puedes reseñar tu propio producto');
    }

    // TODO: exigir una compra completada del producto cuando exista el
    // módulo de transacciones. Por ahora cualquier usuario autenticado que
    // no sea el dueño puede reseñar.
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
      if (
        error instanceof QueryFailedError &&
        (error.driverError as PostgresError).code === '23505'
      ) {
        throw new ConflictException('Ya reseñaste este producto');
      }
      throw error;
    }
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
