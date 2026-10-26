import request from 'supertest';
import { Notification } from '../src/notifications/entities/notification.entity';
import { NotificationType } from '../src/notifications/enums/notification-type.enum';
import { Subscription } from '../src/subscriptions/entities/subscription.entity';
import { SubscriptionPeriod } from '../src/subscriptions/subscription-period.enum';
import { SubscriptionsCronService } from '../src/subscriptions/subscriptions-cron.service';
import { SubscriptionsModule } from '../src/subscriptions/subscriptions.module';
import { User } from '../src/users/entities/user.entity';
import {
  createNotificationsTestApp,
  NotificationsTestApp,
} from './utils/notifications-test-app';

/**
 * Avisos de la suscripción contra Postgres real: pago confirmado (evento) y
 * el cron de por vencer / vencida con marcadores atómicos.
 */
jest.setTimeout(120_000);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('Notificaciones de la suscripción (e2e)', () => {
  let ctx: NotificationsTestApp;
  let cron: SubscriptionsCronService;
  let seq = 0;

  const newUser = async (isActive = true): Promise<User> => {
    seq += 1;
    const users = ctx.repo(User);
    return users.save(
      users.create({
        email: `sub${seq}@e2e.test`,
        username: `sub_user_${seq}`,
        isActive,
      }),
    );
  };
  const subscribe = (user: User, endsInMs: number, cancelAtPeriodEnd = false) =>
    ctx.repo(Subscription).save({
      userId: user.id,
      period: SubscriptionPeriod.MONTHLY,
      startsAt: new Date(Date.now() - 20 * DAY),
      endsAt: new Date(Date.now() + endsInMs),
      cancelAtPeriodEnd,
    });
  const setEnds = (user: User, endsInMs: number) =>
    ctx.dataSource.query(
      `UPDATE subscription SET ends_at = now() + make_interval(secs => $2) WHERE user_id = $1`,
      [user.id, endsInMs / 1000],
    );
  const notificationsOf = (user: User, type: NotificationType) =>
    ctx.repo(Notification).find({
      where: { userId: user.id, type },
      order: { createdAt: 'ASC' },
    });
  const markAllRead = (user: User) =>
    ctx.dataSource.query(
      `UPDATE notification SET read_at = now() WHERE user_id = $1`,
      [user.id],
    );

  beforeAll(async () => {
    ctx = await createNotificationsTestApp([SubscriptionsModule]);
    cron = ctx.app.get(SubscriptionsCronService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('pago confirmado', () => {
    it('notifica una vez al pagar y no repite al reintentar la misma clave', async () => {
      const user = await newUser();
      const pay = () =>
        request(ctx.app.getHttpServer())
          .post('/subscriptions/checkout')
          .set({
            Cookie: ctx.cookieFor(user),
            'Idempotency-Key': `notif-pago-${user.id}`,
          })
          .send({
            period: 'monthly',
            card: {
              cardNumber: '4242424242424242',
              expiryMonth: 12,
              expiryYear: 2099,
              cvv: '123',
              cardHolderName: 'Ana Compradora',
            },
          })
          .expect(201);

      const first = await pay();
      await ctx.waitFor(async () => {
        expect(
          await notificationsOf(
            user,
            NotificationType.SUBSCRIPTION_PAYMENT_CONFIRMED,
          ),
        ).toHaveLength(1);
      });
      await pay();
      await new Promise((resolve) => setTimeout(resolve, 200));

      const [notification] = await notificationsOf(
        user,
        NotificationType.SUBSCRIPTION_PAYMENT_CONFIRMED,
      );
      expect(
        await notificationsOf(
          user,
          NotificationType.SUBSCRIPTION_PAYMENT_CONFIRMED,
        ),
      ).toHaveLength(1);
      expect(notification.data).toMatchObject({
        paymentId: (first.body as { id: string }).id,
        period: 'monthly',
        amount: 4.99,
        currency: 'USD',
        renewal: false,
      });
      expect(notification.message).toContain('Pago de Mynted Pro confirmado');
    });
  });

  describe('por vencer (3 días antes)', () => {
    it('avisa una vez, con cancelAtPeriodEnd, aunque el cron corra de nuevo', async () => {
      const user = await newUser();
      await subscribe(user, 2 * DAY);

      await expect(cron.notifyExpiring()).resolves.toBeGreaterThanOrEqual(1);
      await cron.notifyExpiring();
      await cron.runOnce();

      const notifications = await notificationsOf(
        user,
        NotificationType.SUBSCRIPTION_EXPIRING_SOON,
      );
      expect(notifications).toHaveLength(1);
      expect(notifications[0].data).toMatchObject({
        period: 'monthly',
        daysRemaining: 2,
        cancelAtPeriodEnd: false,
      });
      const subscription = await ctx
        .repo(Subscription)
        .findOneByOrFail({ userId: user.id });
      expect(subscription.expiringNotifiedFor).toEqual(subscription.endsAt);
    });

    it('incluye cancelAtPeriodEnd cuando el usuario canceló', async () => {
      const user = await newUser();
      await subscribe(user, 1 * DAY, true);

      await cron.notifyExpiring();

      const [notification] = await notificationsOf(
        user,
        NotificationType.SUBSCRIPTION_EXPIRING_SOON,
      );
      expect(notification.data.cancelAtPeriodEnd).toBe(true);
      expect(notification.message).toContain('Cancelaste la renovación');
    });

    it('no vuelve a avisar aunque el usuario ya haya leído el aviso', async () => {
      const user = await newUser();
      await subscribe(user, 2 * DAY);
      await cron.notifyExpiring();
      await markAllRead(user);

      await cron.notifyExpiring();

      expect(
        await notificationsOf(
          user,
          NotificationType.SUBSCRIPTION_EXPIRING_SOON,
        ),
      ).toHaveLength(1);
    });

    it('avisa de nuevo tras renovar (cambia ends_at) cuando vuelve a estar por vencer', async () => {
      const user = await newUser();
      await subscribe(user, 2 * DAY);
      await cron.notifyExpiring();
      await markAllRead(user);

      // Renovó: ends_at se fue lejos. El cron no avisa nada.
      await setEnds(user, 30 * DAY);
      await cron.notifyExpiring();
      expect(
        await notificationsOf(
          user,
          NotificationType.SUBSCRIPTION_EXPIRING_SOON,
        ),
      ).toHaveLength(1);

      // Un mes después el nuevo ends_at vuelve a estar a 2 días.
      await setEnds(user, 2 * DAY);
      await cron.notifyExpiring();
      expect(
        await notificationsOf(
          user,
          NotificationType.SUBSCRIPTION_EXPIRING_SOON,
        ),
      ).toHaveLength(2);
    });

    it('dos corridas simultáneas avisan una sola vez', async () => {
      const user = await newUser();
      await subscribe(user, 2 * DAY);

      await Promise.all([cron.notifyExpiring(), cron.notifyExpiring()]);

      expect(
        await notificationsOf(
          user,
          NotificationType.SUBSCRIPTION_EXPIRING_SOON,
        ),
      ).toHaveLength(1);
    });

    it('no avisa si falta más de 3 días ni si ya venció', async () => {
      const far = await newUser();
      const past = await newUser();
      await subscribe(far, 10 * DAY);
      await subscribe(past, -2 * HOUR);

      await cron.notifyExpiring();

      for (const user of [far, past]) {
        expect(
          await notificationsOf(
            user,
            NotificationType.SUBSCRIPTION_EXPIRING_SOON,
          ),
        ).toHaveLength(0);
      }
    });

    it('respeta a los usuarios desactivados: no avisa ni reclama; al reactivarse sí avisa', async () => {
      const user = await newUser(false);
      await subscribe(user, 2 * DAY);

      await cron.notifyExpiring();

      expect(
        await notificationsOf(
          user,
          NotificationType.SUBSCRIPTION_EXPIRING_SOON,
        ),
      ).toHaveLength(0);
      expect(
        (await ctx.repo(Subscription).findOneByOrFail({ userId: user.id }))
          .expiringNotifiedFor,
      ).toBeNull();

      await ctx.repo(User).update(user.id, { isActive: true });
      await cron.notifyExpiring();

      expect(
        await notificationsOf(
          user,
          NotificationType.SUBSCRIPTION_EXPIRING_SOON,
        ),
      ).toHaveLength(1);
    });
  });

  describe('vencida', () => {
    it('avisa una vez al vencer y de nuevo si vence otra vez tras renovar', async () => {
      const user = await newUser();
      await subscribe(user, -2 * HOUR);

      await cron.notifyExpired();
      await cron.notifyExpired();
      expect(
        await notificationsOf(user, NotificationType.SUBSCRIPTION_EXPIRED),
      ).toHaveLength(1);

      // Renovó y volvió a vencer: otro ends_at, otro aviso.
      await setEnds(user, 10 * DAY);
      await setEnds(user, -1 * HOUR);
      await cron.notifyExpired();

      const notifications = await notificationsOf(
        user,
        NotificationType.SUBSCRIPTION_EXPIRED,
      );
      expect(notifications).toHaveLength(2);
      expect(notifications[0].message).toContain('venció');
    });

    it('no avisa vencimientos viejos ni de usuarios desactivados', async () => {
      const stale = await newUser();
      const inactive = await newUser(false);
      await subscribe(stale, -30 * DAY);
      await subscribe(inactive, -2 * HOUR);

      await cron.notifyExpired();

      for (const user of [stale, inactive]) {
        expect(
          await notificationsOf(user, NotificationType.SUBSCRIPTION_EXPIRED),
        ).toHaveLength(0);
      }
    });

    it('un vencimiento reciente no genera además el aviso de por vencer', async () => {
      const user = await newUser();
      await subscribe(user, -1 * HOUR);

      await cron.runOnce();

      expect(
        await notificationsOf(
          user,
          NotificationType.SUBSCRIPTION_EXPIRING_SOON,
        ),
      ).toHaveLength(0);
      expect(
        await notificationsOf(user, NotificationType.SUBSCRIPTION_EXPIRED),
      ).toHaveLength(1);
    });
  });

  it('los avisos viajan por la API de notificaciones con su type y data', async () => {
    const user = await newUser();
    await subscribe(user, 2 * DAY);
    await cron.notifyExpiring();

    const response = await request(ctx.app.getHttpServer())
      .get('/notifications')
      .set('Cookie', ctx.cookieFor(user))
      .expect(200);

    const body = response.body as {
      data: { type: string; data: Record<string, unknown> }[];
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      type: 'subscription_expiring_soon',
      data: { cancelAtPeriodEnd: false },
    });
  });
});
