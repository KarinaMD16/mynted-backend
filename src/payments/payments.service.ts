import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  Product,
  ProductStatus,
  ProductType,
} from '../products/entities/product.entity';
import { Seller } from '../sellers/entities/seller.entity';
import { User } from '../users/entities/user.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { TransactionStatus } from './enums/transaction-status.enum';
import { CommissionService } from './commission/commission.service';
import { PAYMENT_GATEWAY } from './gateway/payment-gateway.constants';
import {
  PaymentGateway,
  PaymentGatewayResult,
} from './gateway/payment-gateway.interface';
import { PaymentCardValidationError } from './gateway/card-validation';
import { CheckoutDto } from './dto/checkout.dto';
import { CheckoutResponseDto } from './dto/checkout-response.dto';
import { QuoteResponseDto } from './dto/quote-response.dto';
import { ExchangeRateService } from './exchange-rate/exchange-rate.service';

type CheckoutResult =
  | { kind: 'completed'; transaction: PaymentTransaction }
  | { kind: 'failed'; transaction: PaymentTransaction };

const IDEMPOTENCY_UNIQUE_CONSTRAINT = 'UQ_payment_transaction_idempotency_key';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Seller)
    private readonly sellerRepository: Repository<Seller>,
    @InjectRepository(PaymentTransaction)
    private readonly paymentTransactionRepository: Repository<PaymentTransaction>,
    private readonly commissionService: CommissionService,
    @Inject(PAYMENT_GATEWAY)
    private readonly paymentGateway: PaymentGateway,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly exchangeRateService: ExchangeRateService,
  ) {}

  async quote(productId: number, userId: string): Promise<QuoteResponseDto> {
    const product = await this.productRepository.findOne({
      where: { id: productId },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    this.validateQuoteProduct(product);

    const seller = await this.sellerRepository.findOne({
      where: { sellerId: product.sellerId },
    });
    if (!seller) {
      throw new InternalServerErrorException(
        'El producto tiene un vendedor inconsistente',
      );
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const currency = this.normalizeProductCurrency(product.currency);
    const commission = await this.commissionService.calculate(
      product.price,
      currency,
      seller.completedSalesCount,
    );
    const response: QuoteResponseDto = {
      productId: product.id,
      amount: product.price,
      currency,
    };

    const userCurrency = this.normalizeOptionalCurrency(user.currency);
    if (userCurrency && userCurrency !== currency) {
      const converted = await this.exchangeRateService.convert(
        product.price,
        currency,
        userCurrency,
      );
      response.convertedAmount = {
        amount: converted.amount,
        currency: converted.currency,
        exchangeRate: converted.rate,
        rateDate: converted.rateDate,
      };
    }

    if (seller.userId === userId) {
      response.commission = {
        rate: commission.rate,
        amount: commission.commissionAmount,
        sellerNet: commission.sellerNet,
        salesTierName: commission.salesTier,
        priceTierName: commission.priceTier,
        salesDiscount: commission.salesDiscount,
        priceDiscount: commission.priceDiscount,
      };
    }
    return response;
  }

  async checkout(
    dto: CheckoutDto,
    buyerId: string,
    rawIdempotencyKey: string | undefined,
  ): Promise<CheckoutResponseDto> {
    const idempotencyKey = this.normalizeIdempotencyKey(rawIdempotencyKey);
    const existing = await this.paymentTransactionRepository.findOne({
      where: { idempotencyKey },
    });
    if (existing)
      return this.replayOrConflict(existing, buyerId, dto.productId);

    let result: CheckoutResult;
    try {
      result = await this.dataSource.transaction(async (manager) =>
        this.executeCheckout(manager, dto, buyerId, idempotencyKey),
      );
    } catch (error: unknown) {
      if (!this.isIdempotencyUniqueViolation(error)) {
        if (this.isPostgresUniqueViolation(error)) {
          throw new InternalServerErrorException(
            'No fue posible completar el pago',
          );
        }
        throw error;
      }
      const concurrent = await this.paymentTransactionRepository.findOne({
        where: { idempotencyKey },
      });
      if (!concurrent) {
        throw new InternalServerErrorException(
          'No fue posible resolver la idempotencia del pago',
        );
      }
      return this.replayOrConflict(concurrent, buyerId, dto.productId);
    }

    if (result.kind === 'failed') {
      throw this.paymentRequired(result.transaction);
    }
    return this.toResponse(result.transaction);
  }

  private async executeCheckout(
    manager: EntityManager,
    dto: CheckoutDto,
    buyerId: string,
    idempotencyKey: string,
  ): Promise<CheckoutResult> {
    const transactionRepository = manager.getRepository(PaymentTransaction);
    const existing = await transactionRepository.findOne({
      where: { idempotencyKey },
    });
    if (existing) {
      return this.replayResultOrConflict(existing, buyerId, dto.productId);
    }

    const product = await manager.getRepository(Product).findOne({
      where: { id: dto.productId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');

    const existingAfterProductLock = await transactionRepository.findOne({
      where: { idempotencyKey },
    });
    if (existingAfterProductLock) {
      return this.replayResultOrConflict(
        existingAfterProductLock,
        buyerId,
        dto.productId,
      );
    }

    if (product.status !== ProductStatus.ACTIVE) {
      throw new ConflictException('El producto no está disponible');
    }
    if (product.type !== ProductType.SALE) {
      throw new BadRequestException(
        'Solo se pueden comprar productos de venta',
      );
    }
    if (
      product.price === null ||
      !Number.isFinite(product.price) ||
      product.price <= 0
    ) {
      throw new BadRequestException('El precio del producto es inválido');
    }
    const currency = this.normalizeProductCurrency(product.currency);

    const seller = await manager.getRepository(Seller).findOne({
      where: { sellerId: product.sellerId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!seller) {
      throw new InternalServerErrorException(
        'El producto tiene un vendedor inconsistente',
      );
    }
    if (seller.userId === buyerId) {
      throw new BadRequestException('No puedes comprar tu propio producto');
    }

    const salesCountBefore = seller.completedSalesCount;
    const commission = await this.commissionService.calculate(
      product.price,
      currency,
      salesCountBefore,
    );

    const pending = transactionRepository.create({
      productId: product.id,
      buyerId,
      sellerId: seller.sellerId,
      amount: product.price,
      currency,
      exchangeRate: commission.exchangeRate,
      normalizedAmountCrc: commission.normalizedAmountCrc,
      salesTierName: commission.salesTier,
      salesDiscount: commission.salesDiscount,
      priceTierName: commission.priceTier,
      priceDiscount: commission.priceDiscount,
      commissionRate: commission.rate,
      commissionAmount: commission.commissionAmount,
      sellerNet: commission.sellerNet,
      status: TransactionStatus.PENDING,
      failureReason: null,
      cardBrand: null,
      cardLast4: null,
      gatewayReference: null,
      idempotencyKey,
      completedAt: null,
    });
    await transactionRepository.save(pending);

    let gatewayResult: PaymentGatewayResult;
    try {
      gatewayResult = await this.paymentGateway.charge({
        amount: product.price,
        currency,
        card: dto.card,
      });
    } catch (error: unknown) {
      if (error instanceof PaymentCardValidationError) {
        throw new BadRequestException('Los datos de la tarjeta son inválidos');
      }
      throw new ServiceUnavailableException(
        'La pasarela de pagos no está disponible',
      );
    }

    if (!gatewayResult.approved) {
      pending.status = TransactionStatus.FAILED;
      pending.failureReason = gatewayResult.failureReason;
      await transactionRepository.save(pending);
      return { kind: 'failed', transaction: pending };
    }

    pending.status = TransactionStatus.COMPLETED;
    pending.gatewayReference = gatewayResult.gatewayReference;
    pending.cardBrand = gatewayResult.cardBrand;
    pending.cardLast4 = gatewayResult.cardLast4;
    pending.failureReason = null;
    pending.completedAt = new Date();
    product.status = ProductStatus.SOLD;
    seller.completedSalesCount = salesCountBefore + 1;

    await transactionRepository.save(pending);
    await manager.getRepository(Product).save(product);
    await manager.getRepository(Seller).save(seller);
    return { kind: 'completed', transaction: pending };
  }

  private replayOrConflict(
    transaction: PaymentTransaction,
    buyerId: string,
    productId: number,
  ): CheckoutResponseDto {
    if (
      transaction.buyerId !== buyerId ||
      transaction.productId !== productId
    ) {
      throw new ConflictException(
        'La clave de idempotencia ya pertenece a otra operación',
      );
    }
    if (transaction.status === TransactionStatus.COMPLETED) {
      return this.toResponse(transaction);
    }
    if (transaction.status === TransactionStatus.FAILED) {
      throw this.paymentRequired(transaction);
    }
    throw new ConflictException(
      transaction.status === TransactionStatus.PENDING
        ? 'La operación de pago todavía está pendiente'
        : 'La transacción no puede reutilizarse para un nuevo checkout',
    );
  }

  private replayResultOrConflict(
    transaction: PaymentTransaction,
    buyerId: string,
    productId: number,
  ): CheckoutResult {
    if (
      transaction.buyerId !== buyerId ||
      transaction.productId !== productId
    ) {
      throw new ConflictException(
        'La clave de idempotencia ya pertenece a otra operación',
      );
    }
    if (transaction.status === TransactionStatus.COMPLETED) {
      return { kind: 'completed', transaction };
    }
    if (transaction.status === TransactionStatus.FAILED) {
      return { kind: 'failed', transaction };
    }
    throw new ConflictException(
      transaction.status === TransactionStatus.PENDING
        ? 'La operación de pago todavía está pendiente'
        : 'La transacción no puede reutilizarse para un nuevo checkout',
    );
  }

  private paymentRequired(transaction: PaymentTransaction): HttpException {
    return new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        transactionId: transaction.id,
        failureReason: transaction.failureReason,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }

  private toResponse(transaction: PaymentTransaction): CheckoutResponseDto {
    return {
      id: transaction.id,
      status: transaction.status,
      amount: transaction.amount,
      currency: transaction.currency,
      commission: {
        salesTierName: transaction.salesTierName,
        salesDiscount: transaction.salesDiscount,
        priceTierName: transaction.priceTierName,
        priceDiscount: transaction.priceDiscount,
        commissionRate: transaction.commissionRate,
        commissionAmount: transaction.commissionAmount,
        sellerNet: transaction.sellerNet,
        exchangeRate: transaction.exchangeRate,
        normalizedAmountCrc: transaction.normalizedAmountCrc,
      },
      gatewayReference: transaction.gatewayReference,
      cardBrand: transaction.cardBrand,
      cardLast4: transaction.cardLast4,
      failureReason: transaction.failureReason,
      completedAt: transaction.completedAt,
    };
  }

  private normalizeIdempotencyKey(value: string | undefined): string {
    if (typeof value !== 'string') {
      throw new BadRequestException('Idempotency-Key es obligatorio');
    }
    const normalized = value.trim();
    if (normalized.length < 8 || normalized.length > 128) {
      throw new BadRequestException(
        'Idempotency-Key debe tener entre 8 y 128 caracteres',
      );
    }
    return normalized;
  }

  private normalizeProductCurrency(value: string | null): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new BadRequestException('La moneda del producto es inválida');
    }
    return value.trim().toUpperCase();
  }

  private normalizeOptionalCurrency(value: string | null): string | null {
    if (typeof value !== 'string' || value.trim() === '') return null;
    return value.trim().toUpperCase();
  }

  private validateQuoteProduct(product: Product): void {
    if (product.status !== ProductStatus.ACTIVE) {
      throw new ConflictException('El producto no está disponible');
    }
    if (product.type !== ProductType.SALE) {
      throw new BadRequestException(
        'Solo se pueden cotizar productos de venta',
      );
    }
    if (
      product.price === null ||
      !Number.isFinite(product.price) ||
      product.price <= 0
    ) {
      throw new BadRequestException('El precio del producto es inválido');
    }
  }

  private isPostgresUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505'
    );
  }

  private isIdempotencyUniqueViolation(error: unknown): boolean {
    return (
      this.isPostgresUniqueViolation(error) &&
      typeof error === 'object' &&
      error !== null &&
      'constraint' in error &&
      (error as { constraint?: unknown }).constraint ===
        IDEMPOTENCY_UNIQUE_CONSTRAINT
    );
  }
}
