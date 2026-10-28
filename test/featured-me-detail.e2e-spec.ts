import request from 'supertest';
import { Category } from '../src/community/entities/category.entity';
import { Community } from '../src/community/entities/community.entity';
import { Tag } from '../src/community/entities/tag.entity';
import { ProductTag } from '../src/products/entities/product-tag.entity';
import {
  Product,
  ProductCondition,
  ProductStatus,
  ProductType,
} from '../src/products/entities/product.entity';
import { ProductsModule } from '../src/products/products.module';
import {
  PaymentInfo,
  PaymentType,
} from '../src/sellers/entities/payment-info.entity';
import { Seller } from '../src/sellers/entities/seller.entity';
import { Subscription } from '../src/subscriptions/entities/subscription.entity';
import { SubscriptionPeriod } from '../src/subscriptions/subscription-period.enum';
import {
  SellerRequestStatus,
  User,
  UserRole,
} from '../src/users/entities/user.entity';
import {
  createNotificationsTestApp,
  NotificationsTestApp,
} from './utils/notifications-test-app';

/**
 * isFeatured en el detalle del producto y en GET /products/me (con
 * featuredEnabled, la preferencia), incluido el estado "en pausa" cuando Pro
 * venció, el producto se vendió o está en una comunidad privada.
 */
jest.setTimeout(90_000);

interface Card {
  id: number;
  title: string;
  isFeatured: boolean;
  featuredEnabled: boolean;
  [key: string]: unknown;
}
interface MineBody {
  totalProducts: number;
  sections: { products: Card[] }[];
}

describe('isFeatured en el detalle y en /products/me (e2e)', () => {
  let ctx: NotificationsTestApp;
  let pro: User;
  let free: User;
  const ids: Record<string, number> = {};

  const http = () => request(ctx.app.getHttpServer());
  const mine = async (user: User = pro) => {
    const response = await http()
      .get('/products/me?productsLimit=50&limit=20')
      .set('Cookie', ctx.cookieFor(user))
      .expect(200);
    const body = response.body as MineBody;
    return new Map(
      body.sections.flatMap((section) =>
        section.products.map((card) => [card.title, card] as const),
      ),
    );
  };
  const detail = async (key: string) =>
    (await http().get(`/products/${ids[key]}`).expect(200)).body as {
      isFeatured: boolean;
    } & Record<string, unknown>;
  const feature = (key: string, secondsAgo = 10) =>
    ctx.dataSource.query(
      `UPDATE product SET featured_at = now() - make_interval(secs => $2) WHERE id = $1`,
      [ids[key], secondsAgo],
    );
  const clearFeatured = () =>
    ctx.dataSource.query('UPDATE product SET featured_at = NULL');
  const setPro = (sql: string) =>
    ctx.dataSource.query(
      `UPDATE subscription SET ends_at = ${sql} WHERE user_id = $1`,
      [pro.id],
    );

  beforeAll(async () => {
    ctx = await createNotificationsTestApp([ProductsModule]);

    const users = ctx.repo(User);
    const seller = (name: string) =>
      users.create({
        email: `${name}@e2e.test`,
        username: name,
        role: UserRole.SELLER,
        sellerRequestStatus: SellerRequestStatus.APPROVED,
        currency: 'USD',
      });
    [pro, free] = await users.save([seller('me_pro'), seller('me_free')]);
    const newStore = async (user: User) => {
      const paymentInfo = await ctx.repo(PaymentInfo).save({
        ownerFullName: user.username,
        name: 'BN',
        number: 'CR000000000000000000',
        type: PaymentType.BANK_ACCOUNT,
      });
      return ctx.repo(Seller).save({
        displayName: `Tienda ${user.username}`,
        description: 'Funkos',
        location: 'San José',
        userId: user.id,
        paymentId: paymentInfo.paymentInfoId,
        isVerified: true,
      });
    };
    const proStore = await newStore(pro);
    const freeStore = await newStore(free);
    await ctx.repo(Subscription).save({
      userId: pro.id,
      period: SubscriptionPeriod.ANNUAL,
      startsAt: new Date(Date.now() - 86_400_000),
      endsAt: new Date(Date.now() + 100 * 86_400_000),
      cancelAtPeriodEnd: false,
    });

    const category = await ctx.repo(Category).save({ name: 'Coleccionables' });
    const privateCommunity = await ctx.repo(Community).save({
      name: 'Secreta',
      description: 'Privada',
      slug: 'secreta',
      isPrivate: true,
      categoryId: category.categoryId,
    });
    const tag = await ctx.repo(Tag).save({ name: 'funko' });
    const product = async (
      key: string,
      owner: Seller,
      values: Partial<Product> = {},
    ) => {
      const saved = await ctx.repo(Product).save({
        title: key,
        description: key,
        imageUrl: 'https://res.cloudinary.com/mynted/cover.png',
        status: ProductStatus.ACTIVE,
        type: ProductType.SALE,
        condition: ProductCondition.NEW,
        price: 10,
        currency: 'USD',
        quantity: 3,
        sellerId: owner.sellerId,
        ...values,
      });
      await ctx
        .repo(ProductTag)
        .save({ productId: saved.id, tagId: tag.tagId });
      ids[key] = saved.id;
    };
    for (const key of ['A', 'B', 'C', 'D', 'plain'])
      await product(key, proStore);
    await product('sold', proStore, {
      status: ProductStatus.SOLD,
      quantity: 0,
    });
    await product('draft', proStore, { status: ProductStatus.DRAFT });
    await product('private', proStore, { communityId: privateCommunity.id });
    await product('free-1', freeStore);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('GET /products/:id', () => {
    it('un producto destacado de un Pro vigente trae isFeatured true', async () => {
      await feature('A');

      expect((await detail('A')).isFeatured).toBe(true);
      expect((await detail('plain')).isFeatured).toBe(false);
    });

    it('no expone la preferencia featuredAt', async () => {
      expect(await detail('A')).not.toHaveProperty('featuredAt');
    });

    it('sin Pro vigente isFeatured es false aunque conserve la preferencia', async () => {
      await feature('free-1');

      expect((await detail('free-1')).isFeatured).toBe(false);
    });

    it('al vencer Pro el detalle deja de decir isFeatured y al renovar vuelve', async () => {
      await setPro(`now() - interval '1 minute'`);
      expect((await detail('A')).isFeatured).toBe(false);

      await setPro(`now() + interval '30 days'`);
      expect((await detail('A')).isFeatured).toBe(true);
    });

    it('un producto de comunidad privada marcado no es destacado efectivo', async () => {
      await feature('private');
      const response = await http()
        .get(`/products/${ids.private}`)
        .set('Cookie', ctx.cookieFor(pro));

      // El dueño siempre puede ver su producto; lo importante es que no se eleve.
      expect((response.body as { isFeatured: boolean }).isFeatured).toBe(false);
      await clearFeatured();
    });
  });

  describe('GET /products/me', () => {
    it('trae isFeatured y featuredEnabled en cada tarjeta sin cambiar el resto de los campos', async () => {
      await clearFeatured();
      await feature('A');

      const cards = await mine();

      expect(cards.get('A')).toMatchObject({
        isFeatured: true,
        featuredEnabled: true,
        title: 'A',
        status: 'active',
        isAvailable: true,
        quantity: 3,
      });
      expect(cards.get('plain')).toMatchObject({
        isFeatured: false,
        featuredEnabled: false,
      });
      for (const card of cards.values()) {
        expect(card).not.toHaveProperty('featuredAt');
      }
    });

    it('un destacado en pausa (vendido, borrador-no, comunidad privada) conserva la preferencia sin elevarse', async () => {
      await feature('sold');
      await feature('private');

      const cards = await mine();

      expect(cards.get('sold')).toMatchObject({
        featuredEnabled: true,
        isFeatured: false,
      });
      expect(cards.get('private')).toMatchObject({
        featuredEnabled: true,
        isFeatured: false,
      });
      expect(cards.get('A')).toMatchObject({
        featuredEnabled: true,
        isFeatured: true,
      });
    });

    it('al vencer Pro todos quedan en pausa (enabled true, isFeatured false) y al renovar se restablecen', async () => {
      await clearFeatured();
      await feature('A', 10);
      await feature('B', 20);

      await setPro(`now() - interval '1 minute'`);
      const paused = await mine();
      for (const key of ['A', 'B']) {
        expect(paused.get(key)).toMatchObject({
          featuredEnabled: true,
          isFeatured: false,
        });
      }

      await setPro(`now() + interval '30 days'`);
      const restored = await mine();
      for (const key of ['A', 'B']) {
        expect(restored.get(key)).toMatchObject({
          featuredEnabled: true,
          isFeatured: true,
        });
      }
    });

    it('de 4 marcados solo se elevan los 3 más recientes; el cuarto queda en pausa', async () => {
      await clearFeatured();
      await feature('A', 10);
      await feature('B', 20);
      await feature('C', 30);
      await feature('D', 40);

      const cards = await mine();

      expect(
        ['A', 'B', 'C', 'D'].map((key) => cards.get(key)?.isFeatured),
      ).toEqual([true, true, true, false]);
      expect(
        ['A', 'B', 'C', 'D'].every((key) => cards.get(key)?.featuredEnabled),
      ).toBe(true);
    });

    it('resuelve el estado de toda la página con una sola consulta', async () => {
      const spy = jest.spyOn(ctx.dataSource, 'query');
      try {
        await mine();
        const featuredQueries = spy.mock.calls.filter(
          ([sql]) =>
            typeof sql === 'string' &&
            sql.includes('product.featured_at IS NOT NULL'),
        );
        expect(featuredQueries).toHaveLength(1);
      } finally {
        spy.mockRestore();
      }
    });

    it('un vendedor sin Pro ve su preferencia en pausa', async () => {
      await clearFeatured();
      await feature('free-1');

      const cards = await mine(free);

      expect(cards.get('free-1')).toMatchObject({
        featuredEnabled: true,
        isFeatured: false,
      });
    });
  });
});
