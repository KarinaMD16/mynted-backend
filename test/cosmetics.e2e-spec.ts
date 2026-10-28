import request from 'supertest';
import {
  Cosmetic,
  CosmeticType,
} from '../src/cosmetics/entities/cosmetic.entity';
import { UserCosmetics } from '../src/cosmetics/entities/user-cosmetics.entity';
import { CosmeticsModule } from '../src/cosmetics/cosmetics.module';
import { CosmeticsSeed } from '../src/cosmetics/cosmetics.seed';
import {
  PaymentInfo,
  PaymentType,
} from '../src/sellers/entities/payment-info.entity';
import { Seller } from '../src/sellers/entities/seller.entity';
import { SellersPublicModule } from '../src/sellers-public/sellers-public.module';
import { Subscription } from '../src/subscriptions/entities/subscription.entity';
import { SubscriptionPeriod } from '../src/subscriptions/subscription-period.enum';
import {
  SellerRequestStatus,
  User,
  UserRole,
} from '../src/users/entities/user.entity';
import { UsersModule } from '../src/users/users.module';
import {
  createNotificationsTestApp,
  NotificationsTestApp,
} from './utils/notifications-test-app';

/**
 * Cosméticos contra Postgres real: catálogo sembrado, equipar (gratuitos y
 * Pro), valor efectivo, vencimiento y renovación sin escribir nada, y su
 * exposición en /users/me, el perfil público y la tienda.
 */
jest.setTimeout(90_000);

interface Asset {
  code: string;
  assetUrl: string | null;
}
interface Banner {
  source: string;
  code: string | null;
  url: string | null;
  staticUrl: string | null;
  isAnimated: boolean;
}
interface Effective {
  banner: Banner;
  gooseSkin: Asset;
  frame: Asset;
}
interface Body {
  isPro: boolean;
  bannerUrl: string | null;
  equipped: {
    banner: { code: string } | null;
    useCustomBanner: boolean;
    customBanner: { isAnimated: boolean } | null;
  };
  cosmetics: Effective;
  data: { username: string; cosmetics: Effective }[];
}

const json = (response: { body: unknown }) => response.body as Body;

describe('Cosméticos (e2e)', () => {
  let ctx: NotificationsTestApp;
  let free: User;
  let pro: User;
  let viewer: User;
  let proStore: Seller;
  const byCode: Record<string, Cosmetic> = {};

  const http = () => request(ctx.app.getHttpServer());
  const as = (user: User) => ({
    get: (path: string) => http().get(path).set('Cookie', ctx.cookieFor(user)),
    put: (path: string, body: object) =>
      http().put(path).set('Cookie', ctx.cookieFor(user)).send(body),
  });
  const id = (code: string) => byCode[code].id;
  const setEnds = (user: User, sql: string) =>
    ctx.dataSource.query(
      `UPDATE subscription SET ends_at = ${sql} WHERE user_id = $1`,
      [user.id],
    );

  beforeAll(async () => {
    ctx = await createNotificationsTestApp([
      UsersModule,
      CosmeticsModule,
      SellersPublicModule,
    ]);
    for (const cosmetic of await ctx.repo(Cosmetic).find()) {
      byCode[cosmetic.code] = cosmetic;
    }

    const users = ctx.repo(User);
    [free, pro, viewer] = await users.save([
      users.create({ email: 'free@e2e.test', username: 'cosm_free' }),
      users.create({
        email: 'pro@e2e.test',
        username: 'cosm_pro',
        role: UserRole.SELLER,
        sellerRequestStatus: SellerRequestStatus.APPROVED,
      }),
      users.create({ email: 'viewer@e2e.test', username: 'cosm_viewer' }),
    ]);
    await ctx.repo(Subscription).save({
      userId: pro.id,
      period: SubscriptionPeriod.ANNUAL,
      startsAt: new Date(Date.now() - 86_400_000),
      endsAt: new Date(Date.now() + 100 * 86_400_000),
      cancelAtPeriodEnd: false,
    });
    const paymentInfo = await ctx.repo(PaymentInfo).save({
      ownerFullName: 'Pro',
      name: 'BN',
      number: 'CR000000000000000000',
      type: PaymentType.BANK_ACCOUNT,
    });
    proStore = await ctx.repo(Seller).save({
      displayName: 'Tienda Pro',
      description: 'Funkos',
      location: 'San José',
      userId: pro.id,
      paymentId: paymentInfo.paymentInfoId,
      isVerified: true,
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('catálogo', () => {
    it('GET /cosmetics es público, ordenado, con proOnly y un solo default por tipo', async () => {
      const response = await http().get('/cosmetics').expect(200);

      const items = response.body as {
        code: string;
        type: string;
        proOnly: boolean;
        isDefault: boolean;
      }[];
      expect(items).toHaveLength(12);
      for (const type of Object.values(CosmeticType)) {
        const ofType = items.filter((item) => item.type === String(type));
        expect(ofType.filter((item) => item.isDefault)).toHaveLength(1);
        expect(ofType.find((item) => item.isDefault)?.proOnly).toBe(false);
      }
      expect(items.find((item) => item.code === 'banner_aurora')?.proOnly).toBe(
        true,
      );
      expect(items.find((item) => item.code === 'banner_sunset')?.proOnly).toBe(
        false,
      );
    });

    it('el seed es idempotente: arrancar de nuevo no duplica ni cambia lo desactivado', async () => {
      await ctx.dataSource.query(
        `UPDATE cosmetic SET is_active = false WHERE code = 'frame_neon'`,
      );
      const seed = ctx.app.get(CosmeticsSeed);
      await seed.onApplicationBootstrap();

      expect(await ctx.repo(Cosmetic).count()).toBe(12);
      const neon = await ctx
        .repo(Cosmetic)
        .findOneByOrFail({ code: 'frame_neon' });
      expect(neon.isActive).toBe(false);
      const catalog = await http().get('/cosmetics').expect(200);
      expect(
        (catalog.body as { code: string }[]).some(
          (c) => c.code === 'frame_neon',
        ),
      ).toBe(false);

      await ctx.dataSource.query(
        `UPDATE cosmetic SET is_active = true WHERE code = 'frame_neon'`,
      );
    });

    it('no puede haber dos defaults del mismo tipo', async () => {
      await expect(
        ctx.dataSource.query(
          `UPDATE cosmetic SET is_default = true WHERE code = 'banner_sunset'`,
        ),
      ).rejects.toThrow();
    });
  });

  describe('usuario gratuito', () => {
    it('exige sesión', async () => {
      await http().get('/users/me/cosmetics').expect(401);
      await http().put('/users/me/cosmetics').send({}).expect(401);
    });

    it('sin nada equipado ve los valores por defecto', async () => {
      const response = await as(free).get('/users/me/cosmetics').expect(200);

      expect(json(response)).toEqual({
        isPro: false,
        equipped: {
          banner: null,
          gooseSkin: null,
          frame: null,
          useCustomBanner: false,
          customBanner: null,
        },
        cosmetics: {
          banner: {
            source: 'default',
            code: 'banner_default',
            url: null,
            staticUrl: null,
            isAnimated: false,
          },
          gooseSkin: { code: 'goose_default', assetUrl: null },
          frame: { code: 'frame_default', assetUrl: null },
        },
      });
    });

    it('puede equipar los cosméticos gratuitos', async () => {
      const response = await as(free)
        .put('/users/me/cosmetics', {
          bannerId: id('banner_sunset'),
          gooseSkinId: id('goose_blue'),
          frameId: id('frame_simple'),
        })
        .expect(200);

      expect(json(response).equipped).toMatchObject({
        banner: { code: 'banner_sunset' },
        gooseSkin: { code: 'goose_blue' },
        frame: { code: 'frame_simple' },
      });
      expect(json(response).cosmetics).toMatchObject({
        banner: { source: 'catalog', code: 'banner_sunset' },
        gooseSkin: { code: 'goose_blue' },
        frame: { code: 'frame_simple' },
      });
    });

    it.each([
      ['banner_aurora', 'bannerId'],
      ['goose_ninja', 'gooseSkinId'],
      ['frame_gold', 'frameId'],
    ])('equipar %s (Pro) es 403 y no cambia nada', async (code, field) => {
      const before = await as(free).get('/users/me/cosmetics').expect(200);

      await as(free)
        .put('/users/me/cosmetics', { [field]: id(code) })
        .expect(403);

      const after = await as(free).get('/users/me/cosmetics').expect(200);
      expect(json(after)).toEqual(json(before));
    });

    it('el banner propio exige Pro', async () => {
      await as(free)
        .put('/users/me/cosmetics', { useCustomBanner: true })
        .expect(403);
    });

    it('valida el tipo, la existencia y el cuerpo', async () => {
      // un skin de ganso en el campo de banner
      await as(free)
        .put('/users/me/cosmetics', { bannerId: id('goose_blue') })
        .expect(400);
      await as(free)
        .put('/users/me/cosmetics', { bannerId: 999_999 })
        .expect(404);
      await as(free).put('/users/me/cosmetics', {}).expect(400);
      await as(free).put('/users/me/cosmetics', { bannerId: 'x' }).expect(400);
      await as(free).put('/users/me/cosmetics', { bannerId: 0 }).expect(400);
      await as(free).put('/users/me/cosmetics', { color: 'rojo' }).expect(400);
    });

    it('null deja ese tipo en el valor por defecto y no toca los demás', async () => {
      const response = await as(free)
        .put('/users/me/cosmetics', { bannerId: null })
        .expect(200);

      expect(json(response).equipped.banner).toBeNull();
      expect(json(response).cosmetics.banner.source).toBe('default');
      expect(json(response).cosmetics.gooseSkin.code).toBe('goose_blue');
    });

    it('un cosmético desactivado en el catálogo no se puede equipar y cae al default', async () => {
      await as(free)
        .put('/users/me/cosmetics', { frameId: id('frame_simple') })
        .expect(200);
      await ctx.dataSource.query(
        `UPDATE cosmetic SET is_active = false WHERE code IN ('frame_simple', 'banner_sunset')`,
      );

      const mine = await as(free).get('/users/me/cosmetics').expect(200);
      expect(json(mine).cosmetics.frame.code).toBe('frame_default');
      await as(free)
        .put('/users/me/cosmetics', { bannerId: id('banner_sunset') })
        .expect(404);

      await ctx.dataSource.query(
        `UPDATE cosmetic SET is_active = true WHERE code IN ('frame_simple', 'banner_sunset')`,
      );
    });
  });

  describe('usuario Pro', () => {
    it('equipa cosméticos Pro y se aplican', async () => {
      const response = await as(pro)
        .put('/users/me/cosmetics', {
          bannerId: id('banner_aurora'),
          gooseSkinId: id('goose_ninja'),
          frameId: id('frame_gold'),
        })
        .expect(200);

      expect(json(response)).toMatchObject({
        isPro: true,
        cosmetics: {
          banner: { source: 'catalog', code: 'banner_aurora' },
          gooseSkin: { code: 'goose_ninja' },
          frame: { code: 'frame_gold' },
        },
      });
    });

    it('GET /users/me trae los cosméticos efectivos junto a isPro', async () => {
      const response = await as(pro).get('/users/me').expect(200);

      expect(json(response)).toMatchObject({
        isPro: true,
        cosmetics: {
          banner: { code: 'banner_aurora' },
          gooseSkin: { code: 'goose_ninja' },
          frame: { code: 'frame_gold' },
        },
      });
    });

    it('el perfil público y la búsqueda de usuarios los traen por usuario', async () => {
      const profile = await as(viewer).get(`/users/${pro.id}`).expect(200);
      expect(json(profile).cosmetics.gooseSkin.code).toBe('goose_ninja');

      const search = await as(viewer).get('/users/search?q=cosm_').expect(200);
      const data = json(search).data as {
        username: string;
        cosmetics: { gooseSkin: { code: string } };
      }[];
      expect(
        Object.fromEntries(
          data.map((user) => [user.username, user.cosmetics.gooseSkin.code]),
        ),
      ).toEqual({
        cosm_free: 'goose_blue',
        cosm_pro: 'goose_ninja',
        cosm_viewer: 'goose_default',
      });
    });

    it('la tienda trae los cosméticos del dueño y bannerUrl es el banner efectivo', async () => {
      await ctx.dataSource.query(
        `UPDATE cosmetic SET asset_url = 'https://cdn.mynted.test/banner_aurora.png' WHERE code = 'banner_aurora'`,
      );

      const store = await http()
        .get(`/sellers/${proStore.sellerId}`)
        .expect(200);

      expect(json(store)).toMatchObject({
        bannerUrl: 'https://cdn.mynted.test/banner_aurora.png',
        cosmetics: { banner: { code: 'banner_aurora', source: 'catalog' } },
      });
    });

    it('useCustomBanner exige haber subido un banner propio', async () => {
      await as(pro)
        .put('/users/me/cosmetics', { useCustomBanner: true })
        .expect(400);
    });

    it('con banner propio preferido se aplica, con su versión estática', async () => {
      await ctx.repo(UserCosmetics).update(
        { userId: pro.id },
        {
          customBannerUrl:
            'https://res.cloudinary.com/mynted/image/upload/v1/pro-banner.gif',
          customBannerPublicId: 'pro-banner',
          customBannerIsAnimated: true,
        },
      );

      const response = await as(pro)
        .put('/users/me/cosmetics', { useCustomBanner: true })
        .expect(200);

      expect(json(response).cosmetics.banner).toEqual({
        source: 'custom',
        code: null,
        url: 'https://res.cloudinary.com/mynted/image/upload/v1/pro-banner.gif',
        staticUrl:
          'https://res.cloudinary.com/mynted/image/upload/v1/pro-banner.jpg',
        isAnimated: true,
      });
      expect(json(response).equipped).toMatchObject({
        useCustomBanner: true,
        customBanner: { isAnimated: true },
      });
      const store = await http()
        .get(`/sellers/${proStore.sellerId}`)
        .expect(200);
      expect(json(store).bannerUrl).toBe(
        'https://res.cloudinary.com/mynted/image/upload/v1/pro-banner.gif',
      );
    });

    it('elegir un banner del catálogo deja de lado el propio sin borrarlo', async () => {
      const response = await as(pro)
        .put('/users/me/cosmetics', { bannerId: id('banner_gold') })
        .expect(200);

      expect(json(response).cosmetics.banner).toMatchObject({
        source: 'catalog',
        code: 'banner_gold',
      });
      expect(json(response).equipped).toMatchObject({
        useCustomBanner: false,
        customBanner: { isAnimated: true },
      });
    });
  });

  describe('vencimiento y renovación', () => {
    it('al vencer Pro todo vuelve al valor por defecto sin borrar lo equipado ni lo subido', async () => {
      await as(pro)
        .put('/users/me/cosmetics', { useCustomBanner: true })
        .expect(200);
      const rowBefore = await ctx
        .repo(UserCosmetics)
        .findOneByOrFail({ userId: pro.id });

      await setEnds(pro, `now() - interval '1 minute'`);

      const mine = await as(pro).get('/users/me/cosmetics').expect(200);
      expect(json(mine).isPro).toBe(false);
      expect(json(mine).cosmetics).toEqual({
        banner: {
          source: 'default',
          code: 'banner_default',
          url: null,
          staticUrl: null,
          isAnimated: false,
        },
        gooseSkin: { code: 'goose_default', assetUrl: null },
        frame: { code: 'frame_default', assetUrl: null },
      });
      // La preferencia sigue guardada.
      expect(json(mine).equipped).toMatchObject({
        banner: { code: 'banner_gold' },
        gooseSkin: { code: 'goose_ninja' },
        frame: { code: 'frame_gold' },
        useCustomBanner: true,
        customBanner: { isAnimated: true },
      });

      // Y en las demás superficies.
      expect(
        json(await as(viewer).get(`/users/${pro.id}`).expect(200)).cosmetics
          .gooseSkin.code,
      ).toBe('goose_default');
      expect(
        json(await as(pro).get('/users/me').expect(200)).cosmetics.banner
          .source,
      ).toBe('default');
      expect(
        json(await http().get(`/sellers/${proStore.sellerId}`).expect(200))
          .cosmetics.frame.code,
      ).toBe('frame_default');

      const rowAfter = await ctx
        .repo(UserCosmetics)
        .findOneByOrFail({ userId: pro.id });
      expect(rowAfter).toEqual(rowBefore);
    });

    it('vencida, no puede equipar Pro pero sí lo gratuito', async () => {
      await as(pro)
        .put('/users/me/cosmetics', { gooseSkinId: id('goose_astronaut') })
        .expect(403);
      await as(pro)
        .put('/users/me/cosmetics', { useCustomBanner: true })
        .expect(403);
      await as(pro)
        .put('/users/me/cosmetics', { gooseSkinId: id('goose_blue') })
        .expect(200);
      // Restaura la preferencia Pro para comprobar la renovación.
      await ctx
        .repo(UserCosmetics)
        .update({ userId: pro.id }, { gooseSkinCosmeticId: id('goose_ninja') });
    });

    it('al renovar todo se restablece solo, sin escribir nada', async () => {
      await setEnds(pro, `now() + interval '30 days'`);

      const mine = await as(pro).get('/users/me/cosmetics').expect(200);

      expect(json(mine).isPro).toBe(true);
      expect(json(mine).cosmetics).toMatchObject({
        banner: { source: 'custom', isAnimated: true },
        gooseSkin: { code: 'goose_ninja' },
        frame: { code: 'frame_gold' },
      });
    });
  });
});
