import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, Repository } from 'typeorm';
import { PaymentCardDto } from '../payments/dto/payment-card.dto';
import { ExchangeRateService } from '../payments/exchange-rate/exchange-rate.service';
import {
  PaymentCardValidationCode,
  PaymentCardValidationError,
} from '../payments/gateway/card-validation';
import { PaymentFailureReason } from '../payments/gateway/payment-failure-reason.enum';
import { PriceDisplayService } from '../pricing/price-display.service';
import { User } from '../users/entities/user.entity';
import {
  SubscriptionPayment,
  SubscriptionPaymentStatus,
} from './entities/subscription-payment.entity';
import { Subscription } from './entities/subscription.entity';
import { addCalendarMonths } from './subscription-dates';
import { SubscriptionEvents } from './subscription-events';
import { SubscriptionPeriod } from './subscription-period.enum';
import { SubscriptionsService } from './subscriptions.service';

const NOW = new Date('2026-10-26T18:00:00.000Z');
const USER = 'user-1';
const KEY = 'sub-key-0001';

const card: PaymentCardDto = {
  cardNumber: '4242424242424242',
  expiryMonth: 12,
  expiryYear: 2099,
  cvv: '123',
  cardHolderName: '  María   José Núñez ',
};

const approved = {
  approved: true as const,
  gatewayReference: 'SIM-ABC123',
  cardBrand: 'visa',
  cardLast4: '4242',
};

function createHarness(options: { rates?: boolean } = {}) {
  const payments: SubscriptionPayment[] = [];
  let subscription: Subscription | null = null;
  let sequence = 0;

  const paymentRepository = {
    findOne: jest.fn(({ where }: { where: Partial<SubscriptionPayment> }) =>
      Promise.resolve(
        payments.find(
          (payment) => payment.idempotencyKey === where.idempotencyKey,
        ) ?? null,
      ),
    ),
    create: jest.fn((value: Partial<SubscriptionPayment>) => ({ ...value })),
    save: jest.fn((value: SubscriptionPayment) => {
      if (!value.id) {
        sequence += 1;
        value.id = `payment-${sequence}`;
        value.createdAt = new Date(NOW.getTime() + sequence);
        payments.push(value);
      }
      return Promise.resolve(value);
    }),
    findAndCount: jest.fn(),
  };
  const subscriptionRepository = {
    findOne: jest.fn(() => Promise.resolve(subscription)),
    create: jest.fn((value: Partial<Subscription>) => ({ ...value })),
    save: jest.fn((value: Subscription) => {
      value.id ??= 'subscription-1';
      subscription = value;
      return Promise.resolve(value);
    }),
    createQueryBuilder: jest.fn(),
  };
  const manager = {
    query: jest.fn().mockResolvedValue([]),
    getRepository: (entity: unknown) =>
      entity === Subscription ? subscriptionRepository : paymentRepository,
  };
  const dataSource = {
    transaction: jest.fn((callback: (m: typeof manager) => unknown) =>
      Promise.resolve(callback(manager)),
    ),
  };
  const gateway = { charge: jest.fn().mockResolvedValue(approved) };
  const getRate = jest.fn((from: string, to: string) =>
    options.rates !== false && from === 'USD' && to === 'CRC'
      ? Promise.resolve({ rate: 500 })
      : Promise.reject(new Error('sin tasa')),
  );
  const priceDisplay = new PriceDisplayService(
    { getRate } as unknown as ExchangeRateService,
    {} as Repository<User>,
  );
  const events = { emit: jest.fn() };

  const service = new SubscriptionsService(
    dataSource as unknown as DataSource,
    subscriptionRepository as unknown as Repository<Subscription>,
    paymentRepository as unknown as Repository<SubscriptionPayment>,
    gateway,
    priceDisplay,
    events as unknown as EventEmitter2,
  );

  return {
    service,
    payments,
    paymentRepository,
    subscriptionRepository,
    manager,
    dataSource,
    gateway,
    events,
    getRate,
    setSubscription: (value: Partial<Subscription> | null) => {
      subscription = value as Subscription | null;
    },
    getSubscription: () => subscription,
  };
}

const existingSubscription = (overrides: Partial<Subscription> = {}) =>
  ({
    id: 'subscription-1',
    userId: USER,
    period: SubscriptionPeriod.MONTHLY,
    startsAt: new Date('2026-10-01T18:00:00.000Z'),
    endsAt: new Date('2026-11-15T18:00:00.000Z'),
    cancelAtPeriodEnd: false,
    expiringNotifiedFor: null,
    expiredNotifiedFor: null,
    ...overrides,
  }) as Subscription;

describe('SubscriptionsService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  describe('checkout aprobado', () => {
    it('crea la suscripción desde ahora y cobra el precio del catálogo en USD', async () => {
      const h = createHarness();

      const result = await h.service.checkout(
        USER,
        { period: SubscriptionPeriod.MONTHLY, card },
        KEY,
        'CRC',
      );

      expect(h.gateway.charge).toHaveBeenCalledWith({
        amount: 4.99,
        currency: 'USD',
        card,
      });
      expect(h.getSubscription()).toMatchObject({
        userId: USER,
        period: 'monthly',
        startsAt: NOW,
        endsAt: addCalendarMonths(NOW, 1),
        cancelAtPeriodEnd: false,
      });
      expect(result).toMatchObject({
        status: 'completed',
        period: 'monthly',
        amount: 4.99,
        currency: 'USD',
        gatewayReference: 'SIM-ABC123',
        cardBrand: 'visa',
        cardLast4: '4242',
        coversFrom: NOW,
        coversUntil: addCalendarMonths(NOW, 1),
        failureReason: null,
      });
    });

    it('guarda el titular normalizado solo si el pago se aprueba', async () => {
      const h = createHarness();

      const result = await h.service.checkout(
        USER,
        { period: SubscriptionPeriod.MONTHLY, card },
        KEY,
        'USD',
      );

      expect(result.cardHolderName).toBe('María José Núñez');
    });

    it('serializa los pagos del usuario con un candado de asesoría', async () => {
      const h = createHarness();

      await h.service.checkout(
        USER,
        { period: SubscriptionPeriod.MONTHLY, card },
        KEY,
        'USD',
      );

      expect(h.manager.query).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
        ['subscription', USER],
      );
    });

    it('semestral desde fin de mes se ajusta al último día del mes', async () => {
      jest.setSystemTime(new Date('2026-08-31T18:00:00.000Z'));
      const h = createHarness();

      const result = await h.service.checkout(
        USER,
        { period: SubscriptionPeriod.SEMIANNUAL, card },
        KEY,
        'USD',
      );

      expect(result.coversUntil).toEqual(new Date('2027-02-28T18:00:00.000Z'));
      expect(result.amount).toBe(24.99);
    });

    it('guarda el precio mostrado en la moneda del usuario', async () => {
      const h = createHarness();

      const result = await h.service.checkout(
        USER,
        { period: SubscriptionPeriod.ANNUAL, card },
        KEY,
        'CRC',
      );

      expect(result).toMatchObject({
        amount: 41.99,
        currency: 'USD',
        displayAmount: 20995,
        displayCurrency: 'CRC',
        exchangeRate: 500,
      });
    });

    it('sin tipo de cambio el cobro sigue y el precio mostrado queda en null', async () => {
      const h = createHarness({ rates: false });

      const result = await h.service.checkout(
        USER,
        { period: SubscriptionPeriod.MONTHLY, card },
        KEY,
        'CRC',
      );

      expect(result).toMatchObject({
        status: 'completed',
        displayAmount: null,
        displayCurrency: null,
        exchangeRate: null,
      });
    });

    it('si la moneda de visualización es USD no consulta tasas', async () => {
      const h = createHarness();

      const result = await h.service.checkout(
        USER,
        { period: SubscriptionPeriod.MONTHLY, card },
        KEY,
        'USD',
      );

      expect(h.getRate).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        displayAmount: 4.99,
        displayCurrency: 'USD',
        exchangeRate: 1,
      });
    });

    it('emite el evento una sola vez, después de la transacción', async () => {
      const h = createHarness();

      await h.service.checkout(
        USER,
        { period: SubscriptionPeriod.MONTHLY, card },
        KEY,
        'USD',
      );

      expect(h.events.emit).toHaveBeenCalledTimes(1);
      expect(h.events.emit).toHaveBeenCalledWith(
        SubscriptionEvents.PAYMENT_COMPLETED,
        {
          paymentId: 'payment-1',
          userId: USER,
          period: 'monthly',
          amount: 4.99,
          currency: 'USD',
          startsAt: NOW,
          endsAt: addCalendarMonths(NOW, 1),
          renewal: false,
        },
      );
    });
  });

  describe('renovación', () => {
    it('con la suscripción vigente suma desde el ends_at actual y conserva starts_at', async () => {
      const h = createHarness();
      const current = existingSubscription();
      h.setSubscription(current);

      const result = await h.service.checkout(
        USER,
        { period: SubscriptionPeriod.ANNUAL, card },
        KEY,
        'USD',
      );

      expect(result.coversFrom).toEqual(new Date('2026-11-15T18:00:00.000Z'));
      expect(result.coversUntil).toEqual(new Date('2027-11-15T18:00:00.000Z'));
      expect(h.getSubscription()).toMatchObject({
        startsAt: new Date('2026-10-01T18:00:00.000Z'),
        endsAt: new Date('2027-11-15T18:00:00.000Z'),
        period: 'annual',
      });
      expect(h.events.emit).toHaveBeenCalledWith(
        SubscriptionEvents.PAYMENT_COMPLETED,
        expect.objectContaining({ renewal: true }),
      );
    });

    it('tras vencer suma desde ahora y reinicia starts_at', async () => {
      const h = createHarness();
      h.setSubscription(
        existingSubscription({
          startsAt: new Date('2026-08-01T18:00:00.000Z'),
          endsAt: new Date('2026-09-01T18:00:00.000Z'),
        }),
      );

      const result = await h.service.checkout(
        USER,
        { period: SubscriptionPeriod.MONTHLY, card },
        KEY,
        'USD',
      );

      expect(result.coversFrom).toEqual(NOW);
      expect(h.getSubscription()).toMatchObject({
        startsAt: NOW,
        endsAt: addCalendarMonths(NOW, 1),
      });
      expect(h.events.emit).toHaveBeenCalledWith(
        SubscriptionEvents.PAYMENT_COMPLETED,
        expect.objectContaining({ renewal: false }),
      );
    });

    it('justo en el vencimiento ya cuenta como vencida', async () => {
      const h = createHarness();
      h.setSubscription(existingSubscription({ endsAt: NOW }));

      const result = await h.service.checkout(
        USER,
        { period: SubscriptionPeriod.MONTHLY, card },
        KEY,
        'USD',
      );

      expect(result.coversFrom).toEqual(NOW);
    });

    it('pagar tras cancelar limpia cancelAtPeriodEnd', async () => {
      const h = createHarness();
      h.setSubscription(existingSubscription({ cancelAtPeriodEnd: true }));

      await h.service.checkout(
        USER,
        { period: SubscriptionPeriod.MONTHLY, card },
        KEY,
        'USD',
      );

      expect(h.getSubscription()?.cancelAtPeriodEnd).toBe(false);
    });

    it('conserva los marcadores de aviso: renovar cambia ends_at y permite avisar de nuevo', async () => {
      const h = createHarness();
      const notifiedFor = new Date('2026-11-15T18:00:00.000Z');
      h.setSubscription(
        existingSubscription({ expiringNotifiedFor: notifiedFor }),
      );

      await h.service.checkout(
        USER,
        { period: SubscriptionPeriod.MONTHLY, card },
        KEY,
        'USD',
      );

      const saved = h.getSubscription()!;
      expect(saved.expiringNotifiedFor).toEqual(notifiedFor);
      expect(saved.endsAt).not.toEqual(notifiedFor);
    });
  });

  describe('pago rechazado', () => {
    it('guarda el pago failed, responde 402 y no cambia ends_at', async () => {
      const h = createHarness();
      const current = existingSubscription();
      h.setSubscription(current);
      const endsAt = current.endsAt;
      h.gateway.charge.mockResolvedValue({
        approved: false,
        failureReason: PaymentFailureReason.CARD_DECLINED,
      });

      const error = await h.service
        .checkout(
          USER,
          { period: SubscriptionPeriod.MONTHLY, card },
          KEY,
          'USD',
        )
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(402);
      expect((error as HttpException).getResponse()).toMatchObject({
        statusCode: 402,
        paymentId: 'payment-1',
        failureReason: 'card_declined',
      });
      expect(h.payments).toHaveLength(1);
      expect(h.payments[0]).toMatchObject({
        status: SubscriptionPaymentStatus.FAILED,
        failureReason: 'card_declined',
        cardHolderName: null,
        cardLast4: null,
        coversFrom: null,
        coversUntil: null,
        subscriptionId: 'subscription-1',
      });
      expect(h.getSubscription()?.endsAt).toBe(endsAt);
      expect(h.subscriptionRepository.save).not.toHaveBeenCalled();
      expect(h.events.emit).not.toHaveBeenCalled();
    });

    it('sin suscripción previa no crea ninguna', async () => {
      const h = createHarness();
      h.gateway.charge.mockResolvedValue({
        approved: false,
        failureReason: PaymentFailureReason.INSUFFICIENT_FUNDS,
      });

      await expect(
        h.service.checkout(
          USER,
          { period: SubscriptionPeriod.MONTHLY, card },
          KEY,
          'USD',
        ),
      ).rejects.toMatchObject({ status: 402 });

      expect(h.getSubscription()).toBeNull();
      expect(h.payments[0].subscriptionId).toBeNull();
    });

    it('una tarjeta con datos inválidos es 400 y no guarda nada', async () => {
      const h = createHarness();
      h.gateway.charge.mockRejectedValue(
        new PaymentCardValidationError(
          PaymentCardValidationCode.INVALID_CARD_NUMBER,
        ),
      );

      await expect(
        h.service.checkout(
          USER,
          { period: SubscriptionPeriod.MONTHLY, card },
          KEY,
          'USD',
        ),
      ).rejects.toThrow(
        new BadRequestException('Los datos de la tarjeta son inválidos'),
      );

      expect(h.payments).toHaveLength(0);
      expect(h.getSubscription()).toBeNull();
    });

    it('cualquier otro error de la pasarela es 503', async () => {
      const h = createHarness();
      h.gateway.charge.mockRejectedValue(new Error('timeout'));

      await expect(
        h.service.checkout(
          USER,
          { period: SubscriptionPeriod.MONTHLY, card },
          KEY,
          'USD',
        ),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(h.payments).toHaveLength(0);
    });
  });

  describe('idempotencia', () => {
    const monthly = { period: SubscriptionPeriod.MONTHLY, card };

    it('la misma clave completada repite la respuesta sin cobrar ni extender', async () => {
      const h = createHarness();
      const first = await h.service.checkout(USER, monthly, KEY, 'USD');
      const endsAt = h.getSubscription()!.endsAt;

      const second = await h.service.checkout(USER, monthly, KEY, 'USD');

      expect(second).toEqual(first);
      expect(h.gateway.charge).toHaveBeenCalledTimes(1);
      expect(h.payments).toHaveLength(1);
      expect(h.getSubscription()!.endsAt).toEqual(endsAt);
      expect(h.events.emit).toHaveBeenCalledTimes(1);
    });

    it('la misma clave fallida repite el 402 sin volver a cobrar', async () => {
      const h = createHarness();
      h.gateway.charge.mockResolvedValue({
        approved: false,
        failureReason: PaymentFailureReason.EXPIRED_CARD,
      });
      await h.service.checkout(USER, monthly, KEY, 'USD').catch(() => null);

      await expect(
        h.service.checkout(USER, monthly, KEY, 'USD'),
      ).rejects.toMatchObject({ status: 402 });

      expect(h.gateway.charge).toHaveBeenCalledTimes(1);
      expect(h.payments).toHaveLength(1);
    });

    it('la misma clave con otro periodo es 409', async () => {
      const h = createHarness();
      await h.service.checkout(USER, monthly, KEY, 'USD');

      await expect(
        h.service.checkout(
          USER,
          { period: SubscriptionPeriod.ANNUAL, card },
          KEY,
          'USD',
        ),
      ).rejects.toThrow(
        new ConflictException(
          'La clave de idempotencia ya pertenece a otra operación',
        ),
      );
      expect(h.gateway.charge).toHaveBeenCalledTimes(1);
    });

    it('la misma clave con otro usuario es 409 y no revela el pago', async () => {
      const h = createHarness();
      await h.service.checkout(USER, monthly, KEY, 'USD');

      await expect(
        h.service.checkout('user-2', monthly, KEY, 'USD'),
      ).rejects.toThrow(ConflictException);
      expect(h.gateway.charge).toHaveBeenCalledTimes(1);
    });

    it('si dos peticiones chocan en el UNIQUE, la perdedora relee y repite', async () => {
      const h = createHarness();
      const winner = await h.service.checkout(USER, monthly, KEY, 'USD');
      // Simula que la primera búsqueda no la vio y el INSERT chocó.
      h.paymentRepository.findOne.mockResolvedValueOnce(null);
      h.dataSource.transaction.mockRejectedValueOnce(
        Object.assign(new Error('duplicate'), {
          code: '23505',
          constraint: 'UQ_subscription_payment_idempotency_key',
        }),
      );

      const loser = await h.service.checkout(USER, monthly, KEY, 'USD');

      expect(loser).toEqual(winner);
      expect(h.gateway.charge).toHaveBeenCalledTimes(1);
    });

    it('un UNIQUE de otra restricción es 500, no una repetición', async () => {
      const h = createHarness();
      h.dataSource.transaction.mockRejectedValueOnce(
        Object.assign(new Error('duplicate'), {
          code: '23505',
          constraint: 'UQ_subscription_user_id',
        }),
      );

      await expect(
        h.service.checkout(USER, monthly, KEY, 'USD'),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('cualquier otro error de la transacción se propaga', async () => {
      const h = createHarness();
      const boom = new Error('boom');
      h.dataSource.transaction.mockRejectedValueOnce(boom);

      await expect(h.service.checkout(USER, monthly, KEY, 'USD')).rejects.toBe(
        boom,
      );
    });

    it.each([
      [undefined, 'Idempotency-Key es obligatorio'],
      ['corta', 'Idempotency-Key debe tener entre 8 y 128 caracteres'],
      ['x'.repeat(129), 'Idempotency-Key debe tener entre 8 y 128 caracteres'],
      ['   abc   ', 'Idempotency-Key debe tener entre 8 y 128 caracteres'],
    ])('rechaza la clave %p', async (key, message) => {
      const h = createHarness();

      await expect(
        h.service.checkout(USER, monthly, key, 'USD'),
      ).rejects.toThrow(new BadRequestException(message));
      expect(h.gateway.charge).not.toHaveBeenCalled();
    });

    it('recorta los espacios de la clave', async () => {
      const h = createHarness();

      await h.service.checkout(USER, monthly, `  ${KEY}  `, 'USD');

      expect(h.payments[0].idempotencyKey).toBe(KEY);
    });
  });

  describe('estado y cancelación', () => {
    it('sin fila: status none', async () => {
      const h = createHarness();

      await expect(h.service.getMine(USER)).resolves.toEqual({
        isPro: false,
        status: 'none',
        period: null,
        startsAt: null,
        endsAt: null,
        cancelAtPeriodEnd: false,
        daysRemaining: 0,
      });
    });

    it('vigente: active con los días que faltan', async () => {
      const h = createHarness();
      h.setSubscription(existingSubscription());

      await expect(h.service.getMine(USER)).resolves.toMatchObject({
        isPro: true,
        status: 'active',
        period: 'monthly',
        cancelAtPeriodEnd: false,
        daysRemaining: 20,
      });
    });

    it('vigente y cancelada: cancelled y sigue siendo Pro', async () => {
      const h = createHarness();
      h.setSubscription(existingSubscription({ cancelAtPeriodEnd: true }));

      await expect(h.service.getMine(USER)).resolves.toMatchObject({
        isPro: true,
        status: 'cancelled',
        cancelAtPeriodEnd: true,
      });
    });

    it('vencida: expired, no es Pro y conserva las fechas', async () => {
      const h = createHarness();
      h.setSubscription(
        existingSubscription({ endsAt: new Date('2026-10-20T18:00:00.000Z') }),
      );

      await expect(h.service.getMine(USER)).resolves.toMatchObject({
        isPro: false,
        status: 'expired',
        endsAt: new Date('2026-10-20T18:00:00.000Z'),
        daysRemaining: 0,
      });
    });

    const withCancelResult = (affected: number | undefined) => {
      const h = createHarness();
      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected }),
      };
      h.subscriptionRepository.createQueryBuilder.mockReturnValue(qb);
      return { h, qb };
    };

    it('cancelar marca cancelAtPeriodEnd solo si sigue vigente', async () => {
      const { h, qb } = withCancelResult(1);
      h.setSubscription(existingSubscription({ cancelAtPeriodEnd: true }));

      await expect(h.service.cancel(USER)).resolves.toMatchObject({
        status: 'cancelled',
        isPro: true,
      });

      expect(qb.set).toHaveBeenCalledWith({ cancelAtPeriodEnd: true });
      expect(qb.where).toHaveBeenCalledWith(
        'user_id = :userId AND ends_at > now()',
        { userId: USER },
      );
    });

    it('cancelar sin suscripción vigente es 409', async () => {
      const { h } = withCancelResult(0);

      await expect(h.service.cancel(USER)).rejects.toThrow(
        new ConflictException('No tienes una suscripción Pro vigente'),
      );
    });
  });

  describe('planes', () => {
    it('muestra los tres precios en USD y convertidos a la moneda del usuario', async () => {
      const h = createHarness();

      const response = await h.service.getPlans('CRC');

      expect(response.plan).toBe('pro');
      expect(response.plans).toEqual([
        {
          period: 'monthly',
          months: 1,
          amount: 4.99,
          currency: 'USD',
          displayAmount: 2495,
          displayCurrency: 'CRC',
          savingsPercent: 0,
        },
        {
          period: 'semiannual',
          months: 6,
          amount: 24.99,
          currency: 'USD',
          displayAmount: 12495,
          displayCurrency: 'CRC',
          savingsPercent: 17,
        },
        {
          period: 'annual',
          months: 12,
          amount: 41.99,
          currency: 'USD',
          displayAmount: 20995,
          displayCurrency: 'CRC',
          savingsPercent: 30,
        },
      ]);
    });

    it('en USD el precio mostrado es el mismo y no consulta tasas', async () => {
      const h = createHarness();

      const response = await h.service.getPlans('USD');

      expect(response.plans.map((plan) => plan.displayAmount)).toEqual([
        4.99, 24.99, 41.99,
      ]);
      expect(h.getRate).not.toHaveBeenCalled();
    });

    it('sin tipo de cambio displayAmount es null y el cobro sigue en USD', async () => {
      const h = createHarness({ rates: false });

      const response = await h.service.getPlans('CRC');

      expect(response.plans.map((plan) => plan.displayAmount)).toEqual([
        null,
        null,
        null,
      ]);
      expect(response.plans.map((plan) => plan.amount)).toEqual([
        4.99, 24.99, 41.99,
      ]);
    });
  });

  describe('historial', () => {
    it('pagina los pagos del usuario, el más reciente primero', async () => {
      const h = createHarness();
      const payment = {
        id: 'p1',
        status: SubscriptionPaymentStatus.FAILED,
        period: SubscriptionPeriod.MONTHLY,
        amount: 4.99,
        currency: 'USD',
        failureReason: 'card_declined',
        createdAt: NOW,
      } as SubscriptionPayment;
      h.paymentRepository.findAndCount.mockResolvedValue([[payment], 11]);

      const result = await h.service.listPayments(USER, { page: 2, limit: 5 });

      expect(h.paymentRepository.findAndCount).toHaveBeenCalledWith({
        where: { userId: USER },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: 5,
        take: 5,
      });
      expect(result.pagination).toEqual({
        page: 2,
        limit: 5,
        total: 11,
        totalPages: 3,
      });
      expect(result.data[0]).toMatchObject({
        id: 'p1',
        status: 'failed',
        failureReason: 'card_declined',
        displayAmount: null,
        cardHolderName: null,
      });
    });
  });
});
