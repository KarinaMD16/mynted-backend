import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { normalizeCardHolderName } from '../payments/dto/payment-card.dto';
import { PaymentCardValidationError } from '../payments/gateway/card-validation';
import { PAYMENT_GATEWAY } from '../payments/gateway/payment-gateway.constants';
import {
  PaymentGateway,
  PaymentGatewayResult,
} from '../payments/gateway/payment-gateway.interface';
import { PriceDisplayService } from '../pricing/price-display.service';
import { SubscriptionCheckoutDto } from './dto/subscription-checkout.dto';
import { SubscriptionPaymentsQueryDto } from './dto/subscription-payments-query.dto';
import {
  MySubscriptionDto,
  SubscriptionPaymentDto,
  SubscriptionPaymentListResponseDto,
  SubscriptionPlansResponseDto,
} from './dto/subscription-response.dto';
import {
  SubscriptionPayment,
  SubscriptionPaymentStatus,
} from './entities/subscription-payment.entity';
import { Subscription } from './entities/subscription.entity';
import {
  SubscriptionEvents,
  SubscriptionPaymentCompletedEvent,
} from './subscription-events';
import {
  addCalendarMonths,
  daysRemaining,
  deriveSubscriptionStatus,
  isSubscriptionCurrent,
} from './subscription-dates';
import {
  SUBSCRIPTION_CURRENCY,
  SUBSCRIPTION_PLANS,
  SubscriptionPlan,
  getSubscriptionPlan,
  savingsPercent,
} from './subscription-plans.config';

const IDEMPOTENCY_UNIQUE_CONSTRAINT = 'UQ_subscription_payment_idempotency_key';

interface DisplaySnapshot {
  displayAmount: number | null;
  displayCurrency: string | null;
  exchangeRate: number | null;
}

type CheckoutResult =
  | {
      kind: 'completed';
      payment: SubscriptionPayment;
      // Pago aprobado en esta llamada (no es la repetición de una clave).
      event?: SubscriptionPaymentCompletedEvent;
    }
  | { kind: 'failed'; payment: SubscriptionPayment };

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(SubscriptionPayment)
    private readonly paymentRepository: Repository<SubscriptionPayment>,
    @Inject(PAYMENT_GATEWAY)
    private readonly paymentGateway: PaymentGateway,
    private readonly priceDisplay: PriceDisplayService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------
  // Planes y estado
  // ---------------------------------------------------------------------

  async getPlans(
    displayCurrency: string,
  ): Promise<SubscriptionPlansResponseDto> {
    const rates = await this.priceDisplay.getDisplayRates(displayCurrency, [
      SUBSCRIPTION_CURRENCY,
    ]);
    return {
      plan: 'pro',
      plans: SUBSCRIPTION_PLANS.map((plan) => ({
        period: plan.period,
        months: plan.months,
        amount: plan.price,
        currency: SUBSCRIPTION_CURRENCY,
        displayAmount: this.priceDisplay.toDisplay(
          {
            price: plan.price,
            discountPercent: null,
            currency: SUBSCRIPTION_CURRENCY,
          },
          displayCurrency,
          rates,
        ).displayPrice,
        displayCurrency,
        savingsPercent: savingsPercent(plan),
      })),
    };
  }

  async getMine(userId: string): Promise<MySubscriptionDto> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { userId },
    });
    return this.toMine(subscription);
  }

  // Marca cancelAtPeriodEnd. Sigue siendo Pro hasta ends_at. Repetirlo no
  // falla; sin suscripción vigente es 409.
  async cancel(userId: string): Promise<MySubscriptionDto> {
    const result = await this.subscriptionRepository
      .createQueryBuilder()
      .update(Subscription)
      .set({ cancelAtPeriodEnd: true })
      .where('user_id = :userId AND ends_at > now()', { userId })
      .execute();
    if (!result.affected) {
      throw new ConflictException('No tienes una suscripción Pro vigente');
    }
    return this.getMine(userId);
  }

  async listPayments(
    userId: string,
    query: SubscriptionPaymentsQueryDto,
  ): Promise<SubscriptionPaymentListResponseDto> {
    const [payments, total] = await this.paymentRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return {
      data: payments.map((payment) => this.toPaymentDto(payment)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  // ---------------------------------------------------------------------
  // Pago
  // ---------------------------------------------------------------------

  // Mismo contrato de idempotencia que el checkout de productos, escrito aquí
  // para no depender de nada interno de pagos.
  async checkout(
    userId: string,
    dto: SubscriptionCheckoutDto,
    rawIdempotencyKey: string | undefined,
    displayCurrency: string,
  ): Promise<SubscriptionPaymentDto> {
    const idempotencyKey = this.normalizeIdempotencyKey(rawIdempotencyKey);
    const plan = getSubscriptionPlan(dto.period);

    const existing = await this.paymentRepository.findOne({
      where: { idempotencyKey },
    });
    if (existing) return this.replay(existing, userId, dto);

    // Precio en la moneda del usuario, informativo: se calcula antes de la
    // transacción para no mantenerla abierta esperando un tipo de cambio.
    const display = await this.displaySnapshot(plan, displayCurrency);

    let result: CheckoutResult;
    try {
      result = await this.dataSource.transaction((manager) =>
        this.executeCheckout(
          manager,
          userId,
          dto,
          plan,
          idempotencyKey,
          display,
        ),
      );
    } catch (error: unknown) {
      if (!this.isIdempotencyUniqueViolation(error)) {
        if (this.isUniqueViolation(error)) {
          throw new InternalServerErrorException(
            'No fue posible completar el pago',
          );
        }
        throw error;
      }
      // Otra petición con la misma clave ganó la carrera: se relee y se repite.
      const concurrent = await this.paymentRepository.findOne({
        where: { idempotencyKey },
      });
      if (!concurrent) {
        throw new InternalServerErrorException(
          'No fue posible resolver la idempotencia del pago',
        );
      }
      return this.replay(concurrent, userId, dto);
    }

    if (result.kind === 'failed') throw this.paymentRequired(result.payment);
    if (result.event) {
      this.eventEmitter?.emit(
        SubscriptionEvents.PAYMENT_COMPLETED,
        result.event,
      );
    }
    return this.toPaymentDto(result.payment);
  }

  private async executeCheckout(
    manager: EntityManager,
    userId: string,
    dto: SubscriptionCheckoutDto,
    plan: SubscriptionPlan,
    idempotencyKey: string,
    display: DisplaySnapshot,
  ): Promise<CheckoutResult> {
    // Serializa los pagos del mismo usuario (claves distintas incluidas): el
    // segundo ve la suscripción ya extendida por el primero.
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      ['subscription', userId],
    );

    const paymentRepository = manager.getRepository(SubscriptionPayment);
    const subscriptionRepository = manager.getRepository(Subscription);

    const existing = await paymentRepository.findOne({
      where: { idempotencyKey },
    });
    if (existing) return this.replayResult(existing, userId, dto);

    let gatewayResult: PaymentGatewayResult;
    try {
      gatewayResult = await this.paymentGateway.charge({
        amount: plan.price,
        currency: SUBSCRIPTION_CURRENCY,
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

    let subscription = await subscriptionRepository.findOne({
      where: { userId },
    });
    const base = {
      userId,
      period: plan.period,
      amount: plan.price,
      currency: SUBSCRIPTION_CURRENCY,
      idempotencyKey,
      ...display,
    };

    if (!gatewayResult.approved) {
      const failed = await paymentRepository.save(
        paymentRepository.create({
          ...base,
          subscriptionId: subscription?.id ?? null,
          status: SubscriptionPaymentStatus.FAILED,
          failureReason: gatewayResult.failureReason,
          gatewayReference: null,
          cardBrand: null,
          cardLast4: null,
          cardHolderName: null,
          coversFrom: null,
          coversUntil: null,
        }),
      );
      return { kind: 'failed', payment: failed };
    }

    // Vigente: se extiende desde el vencimiento actual. Vencida o sin fila:
    // desde ahora, y el tramo empieza ahora.
    const now = this.now();
    const renewal = isSubscriptionCurrent(subscription, now);
    const coversFrom = renewal ? subscription!.endsAt : now;
    const coversUntil = addCalendarMonths(coversFrom, plan.months);

    if (subscription) {
      if (!renewal) subscription.startsAt = now;
      subscription.period = plan.period;
      subscription.endsAt = coversUntil;
      subscription.cancelAtPeriodEnd = false;
    } else {
      subscription = subscriptionRepository.create({
        userId,
        period: plan.period,
        startsAt: now,
        endsAt: coversUntil,
        cancelAtPeriodEnd: false,
        expiringNotifiedFor: null,
        expiredNotifiedFor: null,
      });
    }
    subscription = await subscriptionRepository.save(subscription);

    const payment = await paymentRepository.save(
      paymentRepository.create({
        ...base,
        subscriptionId: subscription.id,
        status: SubscriptionPaymentStatus.COMPLETED,
        failureReason: null,
        gatewayReference: gatewayResult.gatewayReference,
        cardBrand: gatewayResult.cardBrand,
        cardLast4: gatewayResult.cardLast4,
        // Como marca y últimos 4: solo se guarda si el pago se aprueba.
        cardHolderName: normalizeCardHolderName(
          dto.card.cardHolderName,
        ) as string,
        coversFrom,
        coversUntil,
      }),
    );

    return {
      kind: 'completed',
      payment,
      event: {
        paymentId: payment.id,
        userId,
        period: plan.period,
        amount: plan.price,
        currency: SUBSCRIPTION_CURRENCY,
        startsAt: subscription.startsAt,
        endsAt: subscription.endsAt,
        renewal,
      },
    };
  }

  // ---------------------------------------------------------------------
  // Idempotencia
  // ---------------------------------------------------------------------

  private replay(
    payment: SubscriptionPayment,
    userId: string,
    dto: SubscriptionCheckoutDto,
  ): SubscriptionPaymentDto {
    const result = this.replayResult(payment, userId, dto);
    if (result.kind === 'failed') throw this.paymentRequired(result.payment);
    return this.toPaymentDto(result.payment);
  }

  private replayResult(
    payment: SubscriptionPayment,
    userId: string,
    dto: SubscriptionCheckoutDto,
  ): CheckoutResult {
    // Misma clave con otro usuario o periodo: es otra operación.
    if (payment.userId !== userId || payment.period !== dto.period) {
      throw new ConflictException(
        'La clave de idempotencia ya pertenece a otra operación',
      );
    }
    if (payment.status === SubscriptionPaymentStatus.COMPLETED) {
      return { kind: 'completed', payment };
    }
    return { kind: 'failed', payment };
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

  private paymentRequired(payment: SubscriptionPayment): HttpException {
    return new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        paymentId: payment.id,
        failureReason: payment.failureReason,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === '23505'
    );
  }

  private isIdempotencyUniqueViolation(error: unknown): boolean {
    return (
      this.isUniqueViolation(error) &&
      (error as { constraint?: unknown }).constraint ===
        IDEMPOTENCY_UNIQUE_CONSTRAINT
    );
  }

  // ---------------------------------------------------------------------
  // Mapeos
  // ---------------------------------------------------------------------

  // Precio mostrado al usuario en su moneda. Sin tipo de cambio queda todo en
  // null (el frontend muestra el USD que se cobró).
  private async displaySnapshot(
    plan: SubscriptionPlan,
    displayCurrency: string,
  ): Promise<DisplaySnapshot> {
    const rates = await this.priceDisplay.getDisplayRates(displayCurrency, [
      SUBSCRIPTION_CURRENCY,
    ]);
    const { displayPrice } = this.priceDisplay.toDisplay(
      {
        price: plan.price,
        discountPercent: null,
        currency: SUBSCRIPTION_CURRENCY,
      },
      displayCurrency,
      rates,
    );
    if (displayPrice === null) {
      return { displayAmount: null, displayCurrency: null, exchangeRate: null };
    }
    return {
      displayAmount: displayPrice,
      displayCurrency,
      exchangeRate: rates.get(displayCurrency) ?? 1,
    };
  }

  private toMine(subscription: Subscription | null): MySubscriptionDto {
    const now = this.now();
    if (!subscription) {
      return {
        isPro: false,
        status: 'none',
        period: null,
        startsAt: null,
        endsAt: null,
        cancelAtPeriodEnd: false,
        daysRemaining: 0,
      };
    }
    return {
      isPro: isSubscriptionCurrent(subscription, now),
      status: deriveSubscriptionStatus(subscription, now),
      period: subscription.period,
      startsAt: subscription.startsAt,
      endsAt: subscription.endsAt,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      daysRemaining: daysRemaining(subscription.endsAt, now),
    };
  }

  private toPaymentDto(payment: SubscriptionPayment): SubscriptionPaymentDto {
    return {
      id: payment.id,
      status: payment.status,
      period: payment.period,
      amount: payment.amount,
      currency: payment.currency,
      displayAmount: payment.displayAmount ?? null,
      displayCurrency: payment.displayCurrency ?? null,
      exchangeRate: payment.exchangeRate ?? null,
      gatewayReference: payment.gatewayReference,
      cardBrand: payment.cardBrand,
      cardLast4: payment.cardLast4,
      cardHolderName: payment.cardHolderName ?? null,
      failureReason: payment.failureReason,
      coversFrom: payment.coversFrom,
      coversUntil: payment.coversUntil,
      createdAt: payment.createdAt,
    };
  }

  // Aparte para poder fijar la hora en las pruebas.
  private now(): Date {
    return new Date();
  }
}
