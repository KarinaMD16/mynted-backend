import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProductType } from '../products/entities/product.entity';
import { Review } from '../products/entities/review.entity';
import { resolveReviewIneligibility } from '../products/review-eligibility';
import { UsersService } from '../users/users.service';
import { Seller } from '../sellers/entities/seller.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { TransactionStatus } from './enums/transaction-status.enum';
import { ExchangeRateService } from './exchange-rate/exchange-rate.service';
import {
  isSupportedCurrency,
  normalizeSupportedCurrency,
} from './exchange-rate/exchange-rate.constants';
import { isIsoDate } from './exchange-rate/date.utils';
import { PaymentHistoryQueryDto } from './dto/payment-history-query.dto';
import { SalesSummaryQueryDto } from './dto/sales-summary-query.dto';
import {
  PaymentPurchaseItemDto,
  PaymentPurchaseListResponseDto,
} from './dto/payment-purchase-response.dto';
import {
  PaymentSaleItemDto,
  PaymentSaleListResponseDto,
} from './dto/payment-sale-response.dto';
import { SalesSummaryResponseDto } from './dto/sales-summary-response.dto';
import { PaymentReceiptResponseDto } from './dto/payment-receipt-response.dto';

const COSTA_RICA_UTC_OFFSET_HOURS = 6;

@Injectable()
export class PaymentHistoryService {
  constructor(
    @InjectRepository(PaymentTransaction)
    private readonly transactionRepository: Repository<PaymentTransaction>,
    @InjectRepository(Seller)
    private readonly sellerRepository: Repository<Seller>,
    private readonly usersService: UsersService,
    private readonly exchangeRateService: ExchangeRateService,
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
  ) {}

  async purchases(
    userId: string,
    query: PaymentHistoryQueryDto,
  ): Promise<PaymentPurchaseListResponseDto> {
    // withDeleted: una compra de un producto que el vendedor borró (soft
    // delete) sigue en el historial; solo el producto tiene deleted_at en
    // estas uniones. productDeleted avisa al frontend.
    const qb = this.transactionRepository
      .createQueryBuilder('transaction')
      .withDeleted()
      .innerJoin('transaction.product', 'product')
      .innerJoin('transaction.seller', 'seller')
      .select(this.baseTransactionSelect())
      .addSelect([
        'product.id',
        'product.title',
        'product.imageUrl',
        'product.type',
        'product.deletedAt',
        'seller.sellerId',
        'seller.userId',
        'seller.displayName',
        'transaction.cardHolderName',
      ])
      .where('transaction.buyer_id = :userId', { userId })
      .andWhere('transaction.status IN (:...statuses)', {
        statuses: [TransactionStatus.COMPLETED, TransactionStatus.REFUNDED],
      })
      .orderBy('transaction.completedAt', 'DESC')
      .addOrderBy('transaction.createdAt', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [transactions, total] = await qb.getManyAndCount();
    // Reseñas propias de los productos de la página, en una sola consulta.
    const reviewIds = await this.findOwnReviewIds(
      userId,
      transactions.map((transaction) => transaction.product.id),
    );
    return {
      data: transactions.map((transaction) =>
        this.toPurchase(transaction, userId, reviewIds),
      ),
      pagination: this.pagination(query, total),
    };
  }

  async sales(
    userId: string,
    query: PaymentHistoryQueryDto,
  ): Promise<PaymentSaleListResponseDto> {
    const seller = await this.findSellerOrForbidden(userId);
    // withDeleted: las ventas de un producto que el vendedor borró (soft
    // delete) siguen en su historial. Solo product tiene deleted_at en estas
    // uniones (buyer es User, sin soft delete).
    const qb = this.transactionRepository
      .createQueryBuilder('transaction')
      .withDeleted()
      .innerJoin('transaction.product', 'product')
      .innerJoin('transaction.buyer', 'buyer')
      .select(this.baseTransactionSelect())
      .addSelect([
        'product.id',
        'product.title',
        'product.imageUrl',
        'product.deletedAt',
        'buyer.id',
        'buyer.username',
        'buyer.photoUrl',
      ])
      .where('transaction.seller_id = :sellerId', {
        sellerId: seller.sellerId,
      })
      .andWhere('transaction.status IN (:...statuses)', {
        statuses: [TransactionStatus.COMPLETED, TransactionStatus.REFUNDED],
      })
      .orderBy('transaction.completedAt', 'DESC')
      .addOrderBy('transaction.createdAt', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [transactions, total] = await qb.getManyAndCount();
    return {
      data: transactions.map((transaction) => this.toSale(transaction)),
      pagination: this.pagination(query, total),
    };
  }

  async salesSummary(
    userId: string,
    query: SalesSummaryQueryDto,
  ): Promise<SalesSummaryResponseDto> {
    const seller = await this.findSellerOrForbidden(userId);
    const user = await this.usersService.findById(userId);
    const targetCurrency = this.normalizeCurrency(user.currency);
    const { fromDate, toDate } = this.dateBounds(query);

    const qb = this.transactionRepository
      .createQueryBuilder('transaction')
      .where('transaction.seller_id = :sellerId', {
        sellerId: seller.sellerId,
      })
      .andWhere('transaction.status = :status', {
        status: TransactionStatus.COMPLETED,
      });
    if (fromDate)
      qb.andWhere('transaction.completed_at >= :fromDate', { fromDate });
    if (toDate) qb.andWhere('transaction.completed_at < :toDate', { toDate });

    const transactions = await qb
      .orderBy('transaction.completed_at', 'ASC')
      .getMany();
    const breakdown = this.buildBreakdown(transactions);
    const rateCache = new Map<string, number>();
    let approximate = false;
    let gross = 0;
    let commissions = 0;
    let net = 0;

    for (const transaction of transactions) {
      const currency = this.normalizeCurrency(transaction.currency);
      if (currency === targetCurrency) {
        gross += transaction.amount;
        commissions += transaction.commissionAmount;
        net += transaction.sellerNet;
        continue;
      }
      approximate = true;
      const date = this.calendarDate(
        transaction.completedAt ?? transaction.createdAt,
      );
      const cacheKey = `${currency}:${date}:${targetCurrency}`;
      let rate = rateCache.get(cacheKey);
      if (rate === undefined) {
        const quote = await this.exchangeRateService.getRate(
          currency,
          targetCurrency,
          { date },
        );
        rate = quote.rate;
        rateCache.set(cacheKey, rate);
      }
      gross += this.roundMoney(transaction.amount * rate);
      commissions += this.roundMoney(transaction.commissionAmount * rate);
      net += this.roundMoney(transaction.sellerNet * rate);
    }

    return {
      currency: targetCurrency,
      period: { from: query.from ?? null, to: query.to ?? null },
      totals: {
        gross: this.roundMoney(gross),
        commissions: this.roundMoney(commissions),
        net: this.roundMoney(net),
      },
      breakdown,
      approximate,
    };
  }

  async receipt(
    userId: string,
    transactionId: string,
  ): Promise<PaymentReceiptResponseDto> {
    // withDeleted: el comprobante de una compra del historial sigue abriendo
    // aunque el vendedor haya borrado el producto.
    const transaction = await this.transactionRepository
      .createQueryBuilder('transaction')
      .withDeleted()
      .innerJoin('transaction.product', 'product')
      .innerJoin('transaction.seller', 'seller')
      .innerJoin('seller.user', 'sellerUser')
      .select(this.baseTransactionSelect())
      .addSelect([
        'transaction.failureReason',
        'transaction.cardBrand',
        'transaction.cardHolderName',
        'transaction.shippingAddress',
        'transaction.shippingStatus',
        'transaction.trackingNumber',
        'transaction.carrier',
        'transaction.shippedAt',
        'transaction.deliveredAt',
        'product.id',
        'product.title',
        'product.imageUrl',
        'seller.sellerId',
        'seller.displayName',
        'seller.userId',
        'sellerUser.id',
      ])
      .where('transaction.id = :transactionId', { transactionId })
      .getOne();
    if (!transaction) throw new NotFoundException('Transacción no encontrada');
    if (
      transaction.buyerId !== userId &&
      transaction.seller?.userId !== userId
    ) {
      throw new ForbiddenException(
        'No tienes permiso para consultar esta transacción',
      );
    }

    const response: PaymentReceiptResponseDto = {
      id: transaction.id,
      status: transaction.status,
      product: {
        id: transaction.product.id,
        title: transaction.product.title,
        imageUrl: transaction.product.imageUrl ?? null,
      },
      seller: {
        sellerId: transaction.seller.sellerId,
        displayName: transaction.seller.displayName,
      },
      amount: transaction.amount,
      currency: transaction.currency,
      date: transaction.completedAt ?? transaction.createdAt,
      cardLast4: transaction.cardLast4,
      gatewayReference: transaction.gatewayReference,
      failureReason: transaction.failureReason,
      shippingAddress: transaction.shippingAddress ?? null,
      shippingStatus: transaction.shippingStatus ?? null,
      trackingNumber: transaction.trackingNumber ?? null,
      carrier: transaction.carrier ?? null,
      shippedAt: transaction.shippedAt ?? null,
      deliveredAt: transaction.deliveredAt ?? null,
    };
    // El nombre del titular es dato personal del comprador: el vendedor no
    // lo recibe.
    if (transaction.buyerId === userId) {
      response.cardHolderName = transaction.cardHolderName ?? null;
    }
    if (transaction.seller.userId === userId) {
      response.commission = {
        salesTierName: transaction.salesTierName,
        priceTierName: transaction.priceTierName,
        commissionRate: transaction.commissionRate,
        commissionAmount: transaction.commissionAmount,
        sellerNet: transaction.sellerNet,
      };
    }
    return response;
  }

  private async findSellerOrForbidden(userId: string): Promise<Seller> {
    const seller = await this.sellerRepository.findOne({ where: { userId } });
    if (!seller) throw new ForbiddenException('El usuario no es vendedor');
    return seller;
  }

  private baseTransactionSelect(): string[] {
    return [
      'transaction.id',
      'transaction.productId',
      'transaction.buyerId',
      'transaction.sellerId',
      'transaction.amount',
      'transaction.currency',
      'transaction.salesTierName',
      'transaction.priceTierName',
      'transaction.commissionRate',
      'transaction.commissionAmount',
      'transaction.sellerNet',
      'transaction.status',
      'transaction.failureReason',
      'transaction.cardLast4',
      'transaction.gatewayReference',
      'transaction.createdAt',
      'transaction.completedAt',
      'transaction.shippingStatus',
    ];
  }

  // productId -> id de la reseña propia (una sola consulta para toda la
  // página, sin N+1).
  private async findOwnReviewIds(
    userId: string,
    productIds: number[],
  ): Promise<Map<number, number>> {
    const unique = [...new Set(productIds)];
    if (unique.length === 0) return new Map();
    const reviews = await this.reviewRepository.find({
      where: { authorId: userId, productId: In(unique) },
      select: { id: true, productId: true },
    });
    return new Map(reviews.map((review) => [review.productId, review.id]));
  }

  private toPurchase(
    transaction: PaymentTransaction,
    userId: string,
    reviewIds: Map<number, number>,
  ): PaymentPurchaseItemDto {
    // Todo ítem de la lista es una compra completada: se aplica la misma regla
    // que POST /products/:id/reviews y canReview del detalle.
    const reviewId = reviewIds.get(transaction.product.id) ?? null;
    const canReview =
      resolveReviewIneligibility({
        isOwner: transaction.seller.userId === userId,
        isExchange: transaction.product.type === ProductType.EXCHANGE,
        purchased: true,
        hasReviewed: reviewId !== null,
      }) === null;
    return {
      id: transaction.id,
      paymentStatus: transaction.status,
      product: {
        id: transaction.product.id,
        title: transaction.product.title,
        imageUrl: transaction.product.imageUrl ?? null,
      },
      seller: {
        sellerId: transaction.seller.sellerId,
        displayName: transaction.seller.displayName,
      },
      amount: transaction.amount,
      currency: transaction.currency,
      completedAt: transaction.completedAt,
      cardLast4: transaction.cardLast4,
      cardHolderName: transaction.cardHolderName ?? null,
      gatewayReference: transaction.gatewayReference,
      shippingStatus: transaction.shippingStatus ?? null,
      // El detalle de un producto borrado da 404: el frontend no debe enlazarlo.
      productDeleted: transaction.product.deletedAt != null,
      canReview,
      hasReviewed: reviewId !== null,
      reviewId,
    };
  }

  private toSale(transaction: PaymentTransaction): PaymentSaleItemDto {
    return {
      id: transaction.id,
      paymentStatus: transaction.status,
      completedAt: transaction.completedAt,
      product: {
        id: transaction.product.id,
        title: transaction.product.title,
        imageUrl: transaction.product.imageUrl ?? null,
      },
      // Mismo cálculo que en purchases: el detalle de un producto borrado da 404.
      productDeleted: transaction.product.deletedAt != null,
      buyer: {
        id: transaction.buyer.id,
        username: transaction.buyer.username,
        photoUrl: transaction.buyer.photoUrl ?? null,
      },
      amount: transaction.amount,
      currency: transaction.currency,
      salesTierName: transaction.salesTierName,
      priceTierName: transaction.priceTierName,
      commissionRate: transaction.commissionRate,
      commissionAmount: transaction.commissionAmount,
      sellerNet: transaction.sellerNet,
      shippingStatus: transaction.shippingStatus ?? null,
    };
  }

  private buildBreakdown(transactions: PaymentTransaction[]) {
    const groups = new Map<
      string,
      {
        gross: number;
        commissions: number;
        net: number;
        transactionCount: number;
      }
    >();
    for (const transaction of transactions) {
      const currency = this.normalizeCurrency(transaction.currency);
      const current = groups.get(currency) ?? {
        gross: 0,
        commissions: 0,
        net: 0,
        transactionCount: 0,
      };
      current.gross += transaction.amount;
      current.commissions += transaction.commissionAmount;
      current.net += transaction.sellerNet;
      current.transactionCount += 1;
      groups.set(currency, current);
    }
    return [...groups.entries()].map(([currency, values]) => ({
      currency,
      gross: this.roundMoney(values.gross),
      commissions: this.roundMoney(values.commissions),
      net: this.roundMoney(values.net),
      transactionCount: values.transactionCount,
    }));
  }

  private dateBounds(query: SalesSummaryQueryDto): {
    fromDate?: Date;
    toDate?: Date;
  } {
    if (query.from && !isIsoDate(query.from))
      throw new BadRequestException('from debe ser una fecha válida');
    if (query.to && !isIsoDate(query.to))
      throw new BadRequestException('to debe ser una fecha válida');
    if (query.from && query.to && query.from > query.to) {
      throw new BadRequestException('from no puede ser posterior a to');
    }
    return {
      fromDate: query.from ? this.crDateStart(query.from) : undefined,
      toDate: query.to ? this.crDateStart(this.addOneDay(query.to)) : undefined,
    };
  }

  private crDateStart(date: string): Date {
    return new Date(`${date}T0${COSTA_RICA_UTC_OFFSET_HOURS}:00:00.000Z`);
  }

  private addOneDay(date: string): string {
    const value = new Date(`${date}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + 1);
    return value.toISOString().slice(0, 10);
  }

  private calendarDate(value: Date): string {
    const shifted = new Date(
      value.getTime() - COSTA_RICA_UTC_OFFSET_HOURS * 60 * 60 * 1000,
    );
    return shifted.toISOString().slice(0, 10);
  }

  private normalizeCurrency(value: string | null): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new BadRequestException(
        'El usuario no tiene una moneda configurada',
      );
    }
    const currency = normalizeSupportedCurrency(value);
    if (!isSupportedCurrency(currency)) {
      throw new BadRequestException(`Moneda no soportada: ${currency}`);
    }
    return currency;
  }

  private pagination(query: PaymentHistoryQueryDto, total: number) {
    return {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  private roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
