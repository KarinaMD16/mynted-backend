import request from 'supertest';
import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner';
import { CommunityModule } from '../src/community/community.module';
import {
  Favorite,
  FavoriteItemType,
} from '../src/community/entities/favorite.entity';
import { Tag } from '../src/community/entities/tag.entity';
import { ProductTag } from '../src/products/entities/product-tag.entity';
import {
  Product,
  ProductCondition,
  ProductStatus,
  ProductType,
} from '../src/products/entities/product.entity';
import { Review } from '../src/products/entities/review.entity';
import { ProductsModule } from '../src/products/products.module';
import { SearchModule } from '../src/search/search.module';
import {
  PaymentInfo,
  PaymentType,
} from '../src/sellers/entities/payment-info.entity';
import { Seller } from '../src/sellers/entities/seller.entity';
import { SellersPublicModule } from '../src/sellers-public/sellers-public.module';
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
 * ratingAverage y reviewsCount (del PRODUCTO) en las tarjetas de todos los
 * listados, con datos reales:
 *  - rated: reseñas 5, 4 y 4 -> 4.3 (un decimal), 3 reseñas
 *  - single: una reseña de 3 -> 3, 1 reseña
 *  - plain: sin reseñas -> null y 0
 * El vendedor tiene 4 reseñas en total (promedio 4): su rating no cambia ni se
 * confunde con el del producto. Cada lista hace una sola consulta de ratings.
 */
jest.setTimeout(90_000);

interface Card {
  id: number;
  ratingAverage: number | null;
  reviewsCount: number;
}

const json = (response: { body: unknown }) =>
  response.body as Record<string, unknown>;

describe('rating del producto en las tarjetas (e2e)', () => {
  let ctx: NotificationsTestApp;
  let sellerUser: User;
  let viewer: User;
  let store: Seller;
  let rated: Product;
  let single: Product;
  let plain: Product;

  const http = () => request(ctx.app.getHttpServer());
  const asViewer = (path: string, user: User = viewer) =>
    http().get(path).set('Cookie', ctx.cookieFor(user));

  const EXPECTED = () => ({
    [rated.id]: { ratingAverage: 4.3, reviewsCount: 3 },
    [single.id]: { ratingAverage: 3, reviewsCount: 1 },
    [plain.id]: { ratingAverage: null, reviewsCount: 0 },
  });

  const ratingsOf = (cards: Card[]) =>
    Object.fromEntries(
      cards.map(({ id, ratingAverage, reviewsCount }) => [
        id,
        { ratingAverage, reviewsCount },
      ]),
    );

  // Consultas de ratings por producto que dispara una petición (el rating del
  // vendedor, de /users/:id, es otra consulta).
  const reviewQueriesFor = async (run: () => Promise<unknown>) => {
    const spy = jest.spyOn(PostgresQueryRunner.prototype, 'query');
    try {
      await run();
      return spy.mock.calls
        .map(([sql]) => sql)
        .filter(
          (sql): sql is string =>
            typeof sql === 'string' &&
            /FROM "review"[\s\S]*GROUP BY "review"."product_id"/.test(sql),
        ).length;
    } finally {
      spy.mockRestore();
    }
  };

  // Lee la lista y comprueba sus ratings y que haga una sola consulta de ellos.
  const expectList = async (
    path: string,
    pick: (body: Record<string, unknown>) => Card[],
    expected: Record<number, unknown> = EXPECTED(),
    user: User = viewer,
  ) => {
    let response: request.Response | undefined;
    const queries = await reviewQueriesFor(async () => {
      response = await asViewer(path, user).expect(200);
    });

    expect(ratingsOf(pick(json(response!)))).toEqual(expected);
    expect(queries).toBe(1);
  };

  beforeAll(async () => {
    ctx = await createNotificationsTestApp([
      UsersModule,
      ProductsModule,
      SellersPublicModule,
      SearchModule,
      CommunityModule,
    ]);

    const users = ctx.repo(User);
    const [seller, ...buyers] = await users.save([
      users.create({
        email: 'rate-seller@e2e.test',
        username: 'rate_seller',
        role: UserRole.SELLER,
        sellerRequestStatus: SellerRequestStatus.APPROVED,
        currency: 'CRC',
      }),
      ...['a', 'b', 'c', 'viewer'].map((name) =>
        users.create({
          email: `rate-${name}@e2e.test`,
          username: `rate_${name}`,
        }),
      ),
    ]);
    sellerUser = seller;
    viewer = buyers[3];

    const paymentInfo = await ctx.repo(PaymentInfo).save({
      ownerFullName: sellerUser.username,
      name: 'BN',
      number: 'CR000000000000000000',
      type: PaymentType.BANK_ACCOUNT,
    });
    store = await ctx.repo(Seller).save({
      displayName: 'Tienda rating',
      description: 'Funkos originales',
      location: 'San José',
      userId: sellerUser.id,
      paymentId: paymentInfo.paymentInfoId,
      isVerified: true,
    });

    const tag = await ctx.repo(Tag).save({ name: 'rating-funko' });
    const product = async (title: string) => {
      const saved = await ctx.repo(Product).save({
        title,
        description: title,
        imageUrl: 'https://res.cloudinary.com/mynted/cover.png',
        status: ProductStatus.ACTIVE,
        type: ProductType.SALE,
        condition: ProductCondition.NEW,
        price: 10,
        currency: 'USD',
        quantity: 3,
        sellerId: store.sellerId,
      });
      await ctx
        .repo(ProductTag)
        .save({ productId: saved.id, tagId: tag.tagId });
      return saved;
    };
    rated = await product('Funko con reseñas');
    single = await product('Funko con una reseña');
    plain = await product('Funko sin reseñas');

    await ctx.repo(Review).save([
      { productId: rated.id, authorId: buyers[0].id, rating: 5 },
      { productId: rated.id, authorId: buyers[1].id, rating: 4 },
      { productId: rated.id, authorId: buyers[2].id, rating: 4 },
      { productId: single.id, authorId: buyers[0].id, rating: 3 },
    ]);

    await ctx.repo(Favorite).save(
      [rated, single, plain].map((item) => ({
        userId: viewer.id,
        itemId: item.id,
        itemType: FavoriteItemType.PRODUCT,
      })),
    );
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('GET /products', async () => {
    await expectList('/products', (body) => body.data as Card[]);
  });

  it('GET /products con filtros y orden por precio', async () => {
    await expectList(
      '/products?sort=price_asc&type=sale',
      (body) => body.data as Card[],
    );
  });

  it('GET /sellers/:sellerId/products', async () => {
    await expectList(
      `/sellers/${store.sellerId}/products`,
      (body) => body.data as Card[],
    );
  });

  it('GET /products/shop', async () => {
    await expectList('/products/shop', (body) =>
      (body.sections as { products: Card[] }[]).flatMap(
        (section) => section.products,
      ),
    );
  });

  it('GET /products/me (el vendedor ve sus propios productos)', async () => {
    await expectList(
      '/products/me',
      (body) =>
        (body.sections as { products: Card[] }[]).flatMap(
          (section) => section.products,
        ),
      EXPECTED(),
      sellerUser,
    );
  });

  it('GET /products/recommended', async () => {
    await expectList(
      '/products/recommended',
      (body) => body as unknown as Card[],
    );
  });

  it('GET /products/:id/related', async () => {
    const { id } = rated;
    await expectList(
      `/products/${id}/related`,
      (body) => body as unknown as Card[],
      {
        [single.id]: EXPECTED()[single.id],
        [plain.id]: EXPECTED()[plain.id],
      },
    );
  });

  it('GET /search?type=products', async () => {
    await expectList(
      '/search?type=products&q=Funko',
      (body) => body.data as Card[],
    );
  });

  it('GET /users/:id/products', async () => {
    await expectList(
      `/users/${sellerUser.id}/products`,
      (body) => body.data as Card[],
    );
  });

  it('GET /favorites/me', async () => {
    await expectList('/favorites/me?type=products', (body) =>
      (body.data as { product: Card }[]).map(({ product }) => product),
    );
  });

  it('una página sin productos no consulta ratings', async () => {
    const queries = await reviewQueriesFor(async () => {
      await asViewer('/products?tag=999999').expect(200);
    });

    expect(queries).toBe(0);
  });

  it('el promedio tiene un decimal y coincide con GET /products/:id', async () => {
    const list = (json(await http().get('/products').expect(200)).data ??
      []) as Card[];

    for (const item of [rated, single, plain]) {
      const detail = json(
        await http().get(`/products/${item.id}`).expect(200),
      ) as unknown as Card;
      const card = list.find((candidate) => candidate.id === item.id)!;

      expect(card.ratingAverage).toBe(detail.ratingAverage);
      expect(card.reviewsCount).toBe(detail.reviewsCount);
    }
    expect(list.find((card) => card.id === rated.id)!.ratingAverage).toBe(4.3);
  });

  it('el rating del vendedor no cambia ni se confunde con el del producto', async () => {
    const detail = json(
      await http().get(`/products/${rated.id}`).expect(200),
    ) as { ratingAverage: number; seller: Record<string, unknown> };
    const profile = json(
      await http().get(`/sellers/${store.sellerId}`).expect(200),
    );

    expect(detail.seller).toMatchObject({ ratingAverage: 4, reviewsCount: 4 });
    expect(profile).toMatchObject({ ratingAverage: 4, reviewsCount: 4 });
    expect(detail.ratingAverage).toBe(4.3);

    // Las tarjetas no agregan rating al objeto seller.
    const [section] = json(await http().get('/products/shop').expect(200))
      .sections as { products: { seller: Record<string, unknown> }[] }[];
    for (const card of section.products) {
      expect(card.seller).not.toHaveProperty('ratingAverage');
      expect(card.seller).not.toHaveProperty('reviewsCount');
    }
  });
});
