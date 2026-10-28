import request from 'supertest';
import { BadgesModule } from '../src/badges/badges.module';
import { Cosmetic } from '../src/cosmetics/entities/cosmetic.entity';
import { UserCosmetics } from '../src/cosmetics/entities/user-cosmetics.entity';
import { CosmeticsModule } from '../src/cosmetics/cosmetics.module';
import { Notification } from '../src/notifications/entities/notification.entity';
import { ReputationModule } from '../src/reputation/reputation.module';
import { SubscriptionsCronService } from '../src/subscriptions/subscriptions-cron.service';
import { SubscriptionsModule } from '../src/subscriptions/subscriptions.module';
import { User } from '../src/users/entities/user.entity';
import { UsersModule } from '../src/users/users.module';
import {
  createNotificationsTestApp,
  NotificationsTestApp,
} from './utils/notifications-test-app';

/**
 * Flujo completo de Pro contra Postgres real y la pasarela simulada:
 * pagar, ver isPro y el badge, equipar un cosmético Pro, vencer (todo vuelve
 * al valor por defecto sin borrar nada) y renovar (todo se restablece solo).
 */
jest.setTimeout(120_000);

interface Body {
  isPro: boolean;
  status: string;
  endsAt: string | null;
  daysRemaining: number;
  badges: { code: string; derived: boolean }[];
  cosmetics: {
    banner: { source: string; code: string | null };
    gooseSkin: { code: string };
    frame: { code: string };
  };
  equipped: {
    banner: { code: string } | null;
    gooseSkin: { code: string } | null;
    frame: { code: string } | null;
  };
}
const json = (response: { body: unknown }) => response.body as Body;

describe('Flujo completo de Pro (e2e)', () => {
  let ctx: NotificationsTestApp;
  let user: User;
  const byCode: Record<string, number> = {};

  const send = (method: 'get' | 'put' | 'post', path: string) =>
    request(ctx.app.getHttpServer())
      [method](path)
      .set('Cookie', ctx.cookieFor(user));
  const get = (path: string) => send('get', path);
  const pay = (key: string, period: string) =>
    send('post', '/subscriptions/checkout')
      .set('Idempotency-Key', key)
      .send({
        period,
        card: {
          cardNumber: '4242424242424242',
          expiryMonth: 12,
          expiryYear: 2099,
          cvv: '123',
          cardHolderName: 'Ana Compradora',
        },
      });
  const badgeCodes = async () =>
    (
      (await get('/users/me/badges').expect(200)) as unknown as {
        body: { code: string }[];
      }
    ).body.map((badge) => badge.code);
  const notificationTypes = async () =>
    (await ctx.repo(Notification).find({ where: { userId: user.id } })).map(
      (notification) => notification.type,
    );

  beforeAll(async () => {
    ctx = await createNotificationsTestApp([
      SubscriptionsModule,
      CosmeticsModule,
      BadgesModule,
      UsersModule,
      ReputationModule,
    ]);
    for (const cosmetic of await ctx.repo(Cosmetic).find()) {
      byCode[cosmetic.code] = cosmetic.id;
    }
    const users = ctx.repo(User);
    user = await users.save(
      users.create({ email: 'flow@e2e.test', username: 'flow_user' }),
    );
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('1. antes de pagar: sin suscripción, sin badge y con los cosméticos por defecto', async () => {
    expect(json(await get('/subscriptions/me').expect(200))).toMatchObject({
      isPro: false,
      status: 'none',
    });
    expect(json(await get('/users/me').expect(200)).isPro).toBe(false);
    expect(await badgeCodes()).not.toContain('pro');
    expect(
      json(await get('/users/me/cosmetics').expect(200)).cosmetics,
    ).toMatchObject({
      banner: { source: 'default' },
      gooseSkin: { code: 'goose_default' },
      frame: { code: 'frame_default' },
    });
  });

  it('2. sin Pro no puede equipar un cosmético Pro', async () => {
    await send('put', '/users/me/cosmetics')
      .send({ gooseSkinId: byCode.goose_ninja })
      .expect(403);
  });

  it('3. paga el plan anual: queda Pro, con badge y aviso de pago confirmado', async () => {
    await pay('flujo-pago-anual-1', 'annual').expect(201);

    expect(json(await get('/subscriptions/me').expect(200))).toMatchObject({
      isPro: true,
      status: 'active',
    });
    expect(json(await get('/users/me').expect(200)).isPro).toBe(true);
    expect(await badgeCodes()).toContain('pro');
    expect(
      json(await get(`/profiles/${user.id}/reputation`).expect(200)).isPro,
    ).toBe(true);
    await ctx.waitFor(async () => {
      expect(await notificationTypes()).toContain(
        'subscription_payment_confirmed',
      );
    });
  });

  it('4. equipa cosméticos Pro y se aplican', async () => {
    const response = await send('put', '/users/me/cosmetics')
      .send({
        bannerId: byCode.banner_aurora,
        gooseSkinId: byCode.goose_ninja,
        frameId: byCode.frame_gold,
      })
      .expect(200);

    expect(json(response).cosmetics).toMatchObject({
      banner: { source: 'catalog', code: 'banner_aurora' },
      gooseSkin: { code: 'goose_ninja' },
      frame: { code: 'frame_gold' },
    });
    expect(json(await get('/users/me').expect(200)).cosmetics).toMatchObject({
      gooseSkin: { code: 'goose_ninja' },
    });
  });

  describe('al vencer', () => {
    let rowBefore: UserCosmetics;

    it('5. vence: deja de ser Pro, pierde el badge y los cosméticos vuelven al defecto', async () => {
      rowBefore = await ctx
        .repo(UserCosmetics)
        .findOneByOrFail({ userId: user.id });
      await ctx.dataSource.query(
        `UPDATE subscription SET ends_at = now() - interval '1 hour' WHERE user_id = $1`,
        [user.id],
      );

      expect(json(await get('/subscriptions/me').expect(200))).toMatchObject({
        isPro: false,
        status: 'expired',
        daysRemaining: 0,
      });
      expect(json(await get('/users/me').expect(200)).isPro).toBe(false);
      expect(await badgeCodes()).not.toContain('pro');
      const mine = json(await get('/users/me/cosmetics').expect(200));
      expect(mine.cosmetics).toMatchObject({
        banner: { source: 'default', code: 'banner_default' },
        gooseSkin: { code: 'goose_default' },
        frame: { code: 'frame_default' },
      });
      // Lo equipado sigue guardado: es la preferencia.
      expect(mine.equipped).toMatchObject({
        banner: { code: 'banner_aurora' },
        gooseSkin: { code: 'goose_ninja' },
        frame: { code: 'frame_gold' },
      });
    });

    it('6. el cron avisa el vencimiento una sola vez', async () => {
      const cron = ctx.app.get(SubscriptionsCronService);

      await cron.notifyExpired();
      await cron.notifyExpired();

      expect(
        (await notificationTypes()).filter(
          (type) => String(type) === 'subscription_expired',
        ),
      ).toHaveLength(1);
    });

    it('7. renueva: todo se restablece solo, sin escribir en los cosméticos', async () => {
      await pay('flujo-pago-mensual-2', 'monthly').expect(201);

      const state = json(await get('/subscriptions/me').expect(200));
      expect(state).toMatchObject({ isPro: true, status: 'active' });
      expect(await badgeCodes()).toContain('pro');
      expect(
        json(await get('/users/me/cosmetics').expect(200)).cosmetics,
      ).toMatchObject({
        banner: { source: 'catalog', code: 'banner_aurora' },
        gooseSkin: { code: 'goose_ninja' },
        frame: { code: 'frame_gold' },
      });
      const rowAfter = await ctx
        .repo(UserCosmetics)
        .findOneByOrFail({ userId: user.id });
      expect(rowAfter.updatedAt).toEqual(rowBefore.updatedAt);
      expect(rowAfter).toEqual(rowBefore);
    });
  });

  it('8. cancelar no quita nada hasta ends_at', async () => {
    await send('post', '/subscriptions/cancel').expect(200);

    expect(json(await get('/subscriptions/me').expect(200))).toMatchObject({
      isPro: true,
      status: 'cancelled',
    });
    expect(await badgeCodes()).toContain('pro');
    expect(
      json(await get('/users/me/cosmetics').expect(200)).cosmetics.gooseSkin
        .code,
    ).toBe('goose_ninja');
  });
});
