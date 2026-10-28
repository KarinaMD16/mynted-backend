import request from 'supertest';
import { BADGE_CODES } from '../src/badges/badges.config';
import { BadgeAwardError, BadgesService } from '../src/badges/badges.service';
import { BadgesModule } from '../src/badges/badges.module';
import { Badge } from '../src/badges/entities/badge.entity';
import { UserBadge } from '../src/badges/entities/user-badge.entity';
import { ReputationModule } from '../src/reputation/reputation.module';
import { Subscription } from '../src/subscriptions/entities/subscription.entity';
import { SubscriptionPeriod } from '../src/subscriptions/subscription-period.enum';
import { User, UserRole } from '../src/users/entities/user.entity';
import { UsersModule } from '../src/users/users.module';
import {
  createNotificationsTestApp,
  NotificationsTestApp,
} from './utils/notifications-test-app';

/**
 * El badge pro es derivado: aparece y desaparece con la vigencia de la
 * suscripción y nunca se guarda en user_badge.
 */
jest.setTimeout(90_000);

interface BadgeJson {
  code: string;
  scope: string;
  rarity: string;
  derived: boolean;
  awardedAt: string | null;
}

describe('Badge pro derivado (e2e)', () => {
  let ctx: NotificationsTestApp;
  let pro: User;
  let free: User;
  let admin: User;
  let badges: BadgesService;

  const http = () => request(ctx.app.getHttpServer());
  const get = (path: string, user: User) =>
    http().get(path).set('Cookie', ctx.cookieFor(user));
  const badgesOf = async (path: string, user: User = free) =>
    (await get(path, user).expect(200)).body as BadgeJson[];
  const codes = (items: BadgeJson[]) => items.map((item) => item.code);
  const setEnds = (user: User, sql: string) =>
    ctx.dataSource.query(
      `UPDATE subscription SET ends_at = ${sql} WHERE user_id = $1`,
      [user.id],
    );

  beforeAll(async () => {
    ctx = await createNotificationsTestApp([
      UsersModule,
      BadgesModule,
      ReputationModule,
    ]);
    badges = ctx.app.get(BadgesService);

    const users = ctx.repo(User);
    [pro, free, admin] = await users.save([
      users.create({ email: 'pro@e2e.test', username: 'pro_user' }),
      users.create({ email: 'free@e2e.test', username: 'free_user' }),
      users.create({
        email: 'admin@e2e.test',
        username: 'admin',
        role: UserRole.SUPERADMIN,
      }),
    ]);
    await ctx.repo(Subscription).save({
      userId: pro.id,
      period: SubscriptionPeriod.MONTHLY,
      startsAt: new Date(Date.now() - 86_400_000),
      endsAt: new Date(Date.now() + 20 * 86_400_000),
      cancelAtPeriodEnd: false,
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('el seed crea el badge pro (scope user) en el catálogo', async () => {
    const badge = await ctx.repo(Badge).findOneByOrFail({ code: 'pro' });

    expect(badge).toMatchObject({
      scope: 'user',
      rarity: 'epic',
      isActive: true,
      threshold: null,
    });
  });

  it('GET /users/:userId/badges lo incluye con derived true y sin fecha', async () => {
    const items = await badgesOf(`/users/${pro.id}/badges`);

    expect(items.find((item) => item.code === 'pro')).toMatchObject({
      scope: 'user',
      rarity: 'epic',
      derived: true,
      awardedAt: null,
    });
  });

  it('GET /users/me/badges y la reputación también lo traen', async () => {
    expect(codes(await badgesOf('/users/me/badges', pro))).toContain('pro');

    const reputation = (await get(
      `/profiles/${pro.id}/reputation`,
      free,
    ).expect(200)) as { body: { isPro: boolean; badges: BadgeJson[] } };
    expect(reputation.body.isPro).toBe(true);
    expect(codes(reputation.body.badges)).toContain('pro');
  });

  it('quien no es Pro no lo tiene', async () => {
    expect(codes(await badgesOf(`/users/${free.id}/badges`))).not.toContain(
      'pro',
    );
    expect(codes(await badgesOf('/users/me/badges', free))).not.toContain(
      'pro',
    );
  });

  it('nunca se guarda en user_badge', async () => {
    const stored = await ctx
      .repo(UserBadge)
      .createQueryBuilder('ub')
      .innerJoin('ub.badge', 'badge')
      .where('badge.code = :code', { code: 'pro' })
      .getCount();

    expect(stored).toBe(0);
  });

  it('otorgarlo lanza error y no deja ninguna fila', async () => {
    await expect(
      badges.awardToUser(pro.id, BADGE_CODES.PRO),
    ).rejects.toBeInstanceOf(BadgeAwardError);
    expect(await ctx.repo(UserBadge).countBy({ userId: pro.id })).toBe(0);
  });

  it('se ordena por rareza junto a los ganados', async () => {
    await badges.awardToUser(pro.id, BADGE_CODES.VERIFIED_SELLER);

    const items = await badgesOf(`/users/${pro.id}/badges`);

    expect(codes(items)).toEqual(['pro', 'verified_seller']);
    expect(items[1]).toMatchObject({ derived: false });
    expect(items[1].awardedAt).not.toBeNull();
  });

  it('el catálogo lo marca como derivado', async () => {
    const catalog = await badgesOf('/badges?scope=user');

    expect(catalog.find((item) => item.code === 'pro')).toMatchObject({
      derived: true,
      awardedAt: null,
    });
  });

  it('el backfill no lo toca', async () => {
    const response = await http()
      .post('/admin/badges/backfill')
      .set('Cookie', ctx.cookieFor(admin))
      .expect(200);

    expect(response.body).toHaveProperty('awarded');
    expect((response.body as { awarded: object }).awarded).not.toHaveProperty(
      'pro',
    );
    expect(
      await ctx
        .repo(UserBadge)
        .createQueryBuilder('ub')
        .innerJoin('ub.badge', 'badge')
        .where('badge.code = :code', { code: 'pro' })
        .getCount(),
    ).toBe(0);
  });

  it('desaparece al vencer la suscripción y vuelve al renovar, sin tocar la base de badges', async () => {
    const stored = () => ctx.repo(UserBadge).countBy({ userId: pro.id });
    const before = await stored();

    await setEnds(pro, `now() - interval '1 minute'`);
    const expired = codes(await badgesOf(`/users/${pro.id}/badges`));
    expect(expired).not.toContain('pro');
    expect(expired).toContain('verified_seller');

    await setEnds(pro, `now() + interval '30 days'`);
    const renewed = codes(await badgesOf(`/users/${pro.id}/badges`));
    expect(renewed).toContain('pro');
    expect(renewed).toContain('verified_seller');
    expect(await stored()).toBe(before);
  });

  it('una suscripción cancelada sigue mostrando el badge hasta ends_at', async () => {
    await ctx.dataSource.query(
      `UPDATE subscription SET cancel_at_period_end = true WHERE user_id = $1`,
      [pro.id],
    );

    expect(codes(await badgesOf(`/users/${pro.id}/badges`))).toContain('pro');
  });
});
