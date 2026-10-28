import request from 'supertest';
import { addCalendarMonths } from '../src/subscriptions/subscription-dates';
import { SubscriptionPayment } from '../src/subscriptions/entities/subscription-payment.entity';
import { Subscription } from '../src/subscriptions/entities/subscription.entity';
import { SubscriptionEvents } from '../src/subscriptions/subscription-events';
import { SubscriptionsModule } from '../src/subscriptions/subscriptions.module';
import { User } from '../src/users/entities/user.entity';
import {
  createNotificationsTestApp,
  NotificationsTestApp,
} from './utils/notifications-test-app';

/**
 * Pro contra Postgres real y la pasarela simulada: planes, pago, renovación
 * (vigente y vencida), cancelación, rechazos, idempotencia y pagos
 * concurrentes del mismo usuario.
 */
jest.setTimeout(120_000);

const json = (response: { body: unknown }) =>
  response.body as Record<string, unknown>;

const card = (cardNumber = '4242424242424242') => ({
  cardNumber,
  expiryMonth: 12,
  expiryYear: 2099,
  cvv: '123',
  cardHolderName: 'Ana  Compradora',
});

describe('Suscripción Pro (e2e)', () => {
  let ctx: NotificationsTestApp;
  let users: User[];
  const completedEvents: unknown[] = [];

  const http = () => request(ctx.app.getHttpServer());
  const checkout = (
    user: User,
    key: string | undefined,
    body: Record<string, unknown> = { period: 'monthly', card: card() },
    displayCurrency?: string,
  ) => {
    const req = http()
      .post('/subscriptions/checkout')
      .set('Cookie', ctx.cookieFor(user));
    if (key !== undefined) req.set('Idempotency-Key', key);
    if (displayCurrency) req.set('X-Display-Currency', displayCurrency);
    return req.send(body);
  };
  const me = (user: User) =>
    http().get('/subscriptions/me').set('Cookie', ctx.cookieFor(user));
  const cancel = (user: User) =>
    http().post('/subscriptions/cancel').set('Cookie', ctx.cookieFor(user));
  const subscriptionOf = (user: User) =>
    ctx.repo(Subscription).findOneByOrFail({ userId: user.id });
  const paymentsOf = (user: User) =>
    ctx.repo(SubscriptionPayment).find({
      where: { userId: user.id },
      order: { createdAt: 'ASC' },
    });
  const expire = (user: User) =>
    ctx.dataSource.query(
      `UPDATE subscription SET ends_at = now() - interval '1 day' WHERE user_id = $1`,
      [user.id],
    );

  beforeAll(async () => {
    ctx = await createNotificationsTestApp([SubscriptionsModule]);
    const repo = ctx.repo(User);
    users = await repo.save(
      ['ana', 'beto', 'carla', 'dani', 'eli', 'fer'].map((name) =>
        repo.create({ email: `${name}@e2e.test`, username: name }),
      ),
    );
    ctx.events.on(SubscriptionEvents.PAYMENT_COMPLETED, (event: unknown) => {
      completedEvents.push(event);
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('planes', () => {
    it('es público y convierte a la moneda de visualización', async () => {
      const response = await http()
        .get('/subscriptions/plans')
        .set('X-Display-Currency', 'CRC')
        .expect(200);

      expect(response.body).toEqual({
        plan: 'pro',
        plans: [
          expect.objectContaining({
            period: 'monthly',
            months: 1,
            amount: 4.99,
            currency: 'USD',
            displayAmount: 2495,
            displayCurrency: 'CRC',
            savingsPercent: 0,
          }),
          expect.objectContaining({
            period: 'semiannual',
            amount: 24.99,
            displayAmount: 12495,
            savingsPercent: 17,
          }),
          expect.objectContaining({
            period: 'annual',
            amount: 41.99,
            displayAmount: 20995,
            savingsPercent: 30,
          }),
        ],
      });
    });

    it('sin tipo de cambio displayAmount es null y amount sigue en USD', async () => {
      const response = await http()
        .get('/subscriptions/plans')
        .set('X-Display-Currency', 'EUR')
        .expect(200);

      const plans = json(response).plans as {
        amount: number;
        displayAmount: number | null;
      }[];
      expect(plans.map((plan) => plan.displayAmount)).toEqual([
        null,
        null,
        null,
      ]);
      expect(plans.map((plan) => plan.amount)).toEqual([4.99, 24.99, 41.99]);
    });
  });

  describe('ciclo completo (pagar, renovar, vencer, cancelar)', () => {
    const ana = () => users[0];

    it('sin suscripción: status none', async () => {
      const response = await me(ana()).expect(200);

      expect(response.body).toEqual({
        isPro: false,
        status: 'none',
        period: null,
        startsAt: null,
        endsAt: null,
        cancelAtPeriodEnd: false,
        daysRemaining: 0,
      });
    });

    it('exige sesión', async () => {
      await http().get('/subscriptions/me').expect(401);
      await http().post('/subscriptions/cancel').expect(401);
      await http().post('/subscriptions/checkout').expect(401);
      await http().get('/subscriptions/me/payments').expect(401);
    });

    it('pago aprobado: crea la suscripción y deja el historial', async () => {
      const response = await checkout(
        ana(),
        'ana-pago-mensual-1',
        { period: 'monthly', card: card() },
        'CRC',
      ).expect(201);

      expect(response.body).toMatchObject({
        status: 'completed',
        period: 'monthly',
        amount: 4.99,
        currency: 'USD',
        displayAmount: 2495,
        displayCurrency: 'CRC',
        exchangeRate: 500,
        cardBrand: 'visa',
        cardLast4: '4242',
        cardHolderName: 'Ana Compradora',
        failureReason: null,
      });
      expect(json(response).gatewayReference).toMatch(/^SIM-/);

      const subscription = await subscriptionOf(ana());
      expect(subscription.endsAt).toEqual(
        addCalendarMonths(subscription.startsAt, 1),
      );
      expect(json(response).coversFrom).toBe(
        subscription.startsAt.toISOString(),
      );
      expect(json(response).coversUntil).toBe(
        subscription.endsAt.toISOString(),
      );
      expect(completedEvents).toHaveLength(1);
      expect(completedEvents[0]).toMatchObject({
        userId: ana().id,
        period: 'monthly',
        renewal: false,
      });

      const state = await me(ana()).expect(200);
      expect(state.body).toMatchObject({
        isPro: true,
        status: 'active',
        period: 'monthly',
        cancelAtPeriodEnd: false,
      });
      expect(json(state).daysRemaining).toBeGreaterThanOrEqual(28);
      expect(json(state).daysRemaining).toBeLessThanOrEqual(31);
    });

    it('renovación con la suscripción vigente: suma desde ends_at y conserva starts_at', async () => {
      const before = await subscriptionOf(ana());

      const response = await checkout(ana(), 'ana-pago-anual-0002', {
        period: 'annual',
        card: card(),
      }).expect(201);

      const after = await subscriptionOf(ana());
      expect(json(response).coversFrom).toBe(before.endsAt.toISOString());
      expect(after.endsAt).toEqual(addCalendarMonths(before.endsAt, 12));
      expect(after.startsAt).toEqual(before.startsAt);
      expect(after.period).toBe('annual');
      expect(await ctx.repo(Subscription).countBy({ userId: ana().id })).toBe(
        1,
      );
      expect(completedEvents[1]).toMatchObject({ renewal: true });
    });

    it('vencida: status expired y deja de ser Pro', async () => {
      await expire(ana());

      const response = await me(ana()).expect(200);

      expect(response.body).toMatchObject({
        isPro: false,
        status: 'expired',
        daysRemaining: 0,
      });
      expect(json(response).endsAt).not.toBeNull();
    });

    it('cancelar con la suscripción vencida es 409', async () => {
      await cancel(ana()).expect(409);
    });

    it('renovación tras vencer: suma desde ahora y reinicia starts_at', async () => {
      const before = await subscriptionOf(ana());

      const response = await checkout(ana(), 'ana-pago-mensual-0003').expect(
        201,
      );

      const after = await subscriptionOf(ana());
      expect(after.startsAt.getTime()).toBeGreaterThan(before.endsAt.getTime());
      expect(Math.abs(after.startsAt.getTime() - Date.now())).toBeLessThan(
        10_000,
      );
      expect(after.endsAt).toEqual(addCalendarMonths(after.startsAt, 1));
      expect(json(response).coversFrom).toBe(after.startsAt.toISOString());
      expect(json(await me(ana()).expect(200)).isPro).toBe(true);
    });

    it('cancelar deja de renovar pero sigue siendo Pro; repetirlo no falla', async () => {
      const first = await cancel(ana()).expect(200);

      expect(first.body).toMatchObject({
        isPro: true,
        status: 'cancelled',
        cancelAtPeriodEnd: true,
      });
      const again = await cancel(ana()).expect(200);
      expect(json(again).status).toBe('cancelled');
    });

    it('pagar tras cancelar limpia la cancelación', async () => {
      const before = await subscriptionOf(ana());

      await checkout(ana(), 'ana-pago-mensual-0004').expect(201);

      const after = await subscriptionOf(ana());
      expect(after.cancelAtPeriodEnd).toBe(false);
      expect(after.endsAt).toEqual(addCalendarMonths(before.endsAt, 1));
      expect(json(await me(ana()).expect(200)).status).toBe('active');
    });

    it('el historial pagina los pagos del usuario, el más reciente primero', async () => {
      const all = await http()
        .get('/subscriptions/me/payments')
        .set('Cookie', ctx.cookieFor(ana()))
        .expect(200);

      expect(json(all).pagination).toEqual({
        page: 1,
        limit: 10,
        total: 4,
        totalPages: 1,
      });
      const stored = await paymentsOf(ana());
      expect(
        (json(all).data as { id: string }[]).map((item) => item.id),
      ).toEqual(stored.map((payment) => payment.id).reverse());

      const page = await http()
        .get('/subscriptions/me/payments?page=2&limit=3')
        .set('Cookie', ctx.cookieFor(ana()))
        .expect(200);
      expect(json(page).data).toHaveLength(1);
      expect(json(page).pagination).toMatchObject({
        page: 2,
        total: 4,
        totalPages: 2,
      });
    });

    it('el historial no mezcla pagos de otros usuarios', async () => {
      const response = await http()
        .get('/subscriptions/me/payments')
        .set('Cookie', ctx.cookieFor(users[5]))
        .expect(200);

      expect(response.body).toEqual({
        data: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });
  });

  describe('pagos rechazados', () => {
    const beto = () => users[1];

    it.each([
      ['4000000000000002', 'card_declined'],
      ['4000000000009995', 'insufficient_funds'],
      ['4000000000000069', 'expired_card'],
    ])(
      'la tarjeta %s responde 402 (%s) y no crea la suscripción',
      async (number, reason) => {
        const response = await checkout(beto(), `beto-rechazo-${reason}`, {
          period: 'monthly',
          card: card(number),
        }).expect(402);

        expect(response.body).toMatchObject({
          statusCode: 402,
          failureReason: reason,
        });
        expect(
          await ctx.repo(Subscription).countBy({ userId: beto().id }),
        ).toBe(0);
      },
    );

    it('guarda los intentos fallidos sin datos de tarjeta y no emite evento', async () => {
      const payments = await paymentsOf(beto());

      expect(payments).toHaveLength(3);
      for (const payment of payments) {
        expect(payment).toMatchObject({
          status: 'failed',
          subscriptionId: null,
          cardHolderName: null,
          cardLast4: null,
          coversFrom: null,
          coversUntil: null,
        });
      }
      expect(
        completedEvents.filter(
          (event) => (event as { userId: string }).userId === beto().id,
        ),
      ).toHaveLength(0);
      expect(json(await me(beto()).expect(200)).status).toBe('none');
    });

    it('repetir la clave de un pago rechazado repite el 402 sin cobrar de nuevo', async () => {
      const response = await checkout(beto(), 'beto-rechazo-card_declined', {
        period: 'monthly',
        card: card(),
      }).expect(402);

      expect(json(response).failureReason).toBe('card_declined');
      expect(await paymentsOf(beto())).toHaveLength(3);
    });

    it('un rechazo no cambia ends_at de una suscripción vigente', async () => {
      await checkout(beto(), 'beto-pago-ok-00001').expect(201);
      const before = await subscriptionOf(beto());

      await checkout(beto(), 'beto-rechazo-vigente', {
        period: 'annual',
        card: card('4000000000000002'),
      }).expect(402);

      const after = await subscriptionOf(beto());
      expect(after.endsAt).toEqual(before.endsAt);
      expect(after.period).toBe('monthly');
    });

    it('una tarjeta inválida es 400 y no guarda ningún pago', async () => {
      const before = (await paymentsOf(beto())).length;

      await checkout(beto(), 'beto-tarjeta-mala-1', {
        period: 'monthly',
        card: card('4242424242424241'),
      }).expect(400);

      expect(await paymentsOf(beto())).toHaveLength(before);
    });
  });

  describe('validación e idempotencia', () => {
    const carla = () => users[2];
    const dani = () => users[3];

    it('Idempotency-Key es obligatorio y de 8 a 128 caracteres', async () => {
      await checkout(carla(), undefined).expect(400);
      await checkout(carla(), 'corta').expect(400);
      await checkout(carla(), 'x'.repeat(129)).expect(400);
      expect(await paymentsOf(carla())).toHaveLength(0);
    });

    it('rechaza un periodo desconocido y campos de más', async () => {
      await checkout(carla(), 'carla-periodo-malo', {
        period: 'weekly',
        card: card(),
      }).expect(400);
      await checkout(carla(), 'carla-campo-extra1', {
        period: 'monthly',
        card: card(),
        amount: 0.01,
      }).expect(400);
      expect(await paymentsOf(carla())).toHaveLength(0);
    });

    it('la misma clave completada repite la respuesta sin cobrar ni extender', async () => {
      const first = await checkout(carla(), 'carla-misma-clave-1').expect(201);
      const endsAt = (await subscriptionOf(carla())).endsAt;
      const events = completedEvents.length;

      const second = await checkout(carla(), 'carla-misma-clave-1').expect(201);

      expect(second.body).toEqual(first.body);
      expect(await paymentsOf(carla())).toHaveLength(1);
      expect((await subscriptionOf(carla())).endsAt).toEqual(endsAt);
      expect(completedEvents).toHaveLength(events);
    });

    it('la misma clave con otro periodo es 409', async () => {
      await checkout(carla(), 'carla-misma-clave-1', {
        period: 'annual',
        card: card(),
      }).expect(409);
      expect(await paymentsOf(carla())).toHaveLength(1);
    });

    it('la misma clave de otro usuario es 409', async () => {
      await checkout(dani(), 'carla-misma-clave-1').expect(409);
      expect(await paymentsOf(dani())).toHaveLength(0);
    });
  });

  describe('pagos concurrentes', () => {
    it('dos pagos del mismo usuario con claves distintas se aplican en serie', async () => {
      const eli = users[4];

      const [a, b] = await Promise.all([
        checkout(eli, 'eli-concurrente-0001'),
        checkout(eli, 'eli-concurrente-0002'),
      ]);

      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      const payments = await paymentsOf(eli);
      expect(payments).toHaveLength(2);
      const [first, second] = [...payments].sort(
        (x, y) => x.coversUntil!.getTime() - y.coversUntil!.getTime(),
      );
      // El segundo arranca donde terminó el primero: nada se pisa.
      expect(second.coversFrom).toEqual(first.coversUntil);
      const subscription = await subscriptionOf(eli);
      expect(subscription.endsAt).toEqual(
        addCalendarMonths(first.coversUntil!, 1),
      );
      expect(await ctx.repo(Subscription).countBy({ userId: eli.id })).toBe(1);
    });

    it('dos peticiones con la misma clave cobran una sola vez', async () => {
      const fer = users[5];

      const [a, b] = await Promise.all([
        checkout(fer, 'fer-misma-clave-0001'),
        checkout(fer, 'fer-misma-clave-0001'),
      ]);

      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(json(a).id).toBe(json(b).id);
      expect(await paymentsOf(fer)).toHaveLength(1);
      const events = completedEvents.filter(
        (event) => (event as { userId: string }).userId === fer.id,
      );
      expect(events).toHaveLength(1);
    });
  });
});
