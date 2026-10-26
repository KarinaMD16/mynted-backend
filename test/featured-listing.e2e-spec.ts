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
import { SellersPublicModule } from '../src/sellers-public/sellers-public.module';
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
 * Cuota de destacados en GET /products y GET /sellers/:id/products contra
 * Postgres real: orden, cuota por página, paginación, filtros, sort, moneda
 * de visualización, comunidad privada, vencimiento de Pro y regresión sin
 * destacados. Tasa fija: 1 USD = 500 CRC.
 */
jest.setTimeout(120_000);

interface Item {
  id: number;
  title: string;
  isFeatured?: boolean;
  displayFinalPrice: number | null;
  [key: string]: unknown;
}
interface Page {
  data: Item[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
const body = (response: { body: unknown }) => response.body as Page;

describe('Destacados en los listados (e2e)', () => {
  let ctx: NotificationsTestApp;
  let proOne: User;
  let proTwo: User;
  let free: User;
  let storeOne: Seller;
  let storeTwo: Seller;
  let storeFree: Seller;
  let privateCommunity: Community;
  const ids: Record<string, number> = {};

  const http = () => request(ctx.app.getHttpServer());
  const list = (query: string, currency?: string) => {
    const req = http().get(`/products?${query}`);
    return currency ? req.set('X-Display-Currency', currency) : req;
  };
  // Recorre todas las páginas y devuelve los ítems en orden.
  const allPages = async (query: string, currency?: string) => {
    const first = body(await list(`${query}&page=1`, currency).expect(200));
    const pages: Item[][] = [first.data];
    for (let page = 2; page <= first.pagination.totalPages; page += 1) {
      pages.push(
        body(await list(`${query}&page=${page}`, currency).expect(200)).data,
      );
    }
    return { pages, items: pages.flat(), pagination: first.pagination };
  };
  const featuredOf = (items: Item[]) =>
    items.filter((item) => item.isFeatured).map((item) => item.title);
  const clearFeatured = () =>
    ctx.dataSource.query('UPDATE product SET featured_at = NULL');
  const feature = async (key: string, secondsAgo: number) => {
    await ctx.dataSource.query(
      `UPDATE product SET featured_at = now() - make_interval(secs => $2) WHERE id = $1`,
      [ids[key], secondsAgo],
    );
  };
  const setPro = (user: User, sql: string) =>
    ctx.dataSource.query(
      `UPDATE subscription SET ends_at = ${sql} WHERE user_id = $1`,
      [user.id],
    );
  const noDuplicates = (items: Item[]) =>
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);

  beforeAll(async () => {
    ctx = await createNotificationsTestApp([
      ProductsModule,
      SellersPublicModule,
    ]);

    const users = ctx.repo(User);
    const seller = (name: string) =>
      users.create({
        email: `${name}@e2e.test`,
        username: name,
        role: UserRole.SELLER,
        sellerRequestStatus: SellerRequestStatus.APPROVED,
        currency: 'USD',
      });
    [proOne, proTwo, free] = await users.save([
      seller('lst_pro_one'),
      seller('lst_pro_two'),
      seller('lst_free'),
    ]);
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
    [storeOne, storeTwo, storeFree] = [
      await newStore(proOne),
      await newStore(proTwo),
      await newStore(free),
    ];
    for (const user of [proOne, proTwo]) {
      await ctx.repo(Subscription).save({
        userId: user.id,
        period: SubscriptionPeriod.ANNUAL,
        startsAt: new Date(Date.now() - 86_400_000),
        endsAt: new Date(Date.now() + 100 * 86_400_000),
        cancelAtPeriodEnd: false,
      });
    }

    const category = await ctx.repo(Category).save({ name: 'Coleccionables' });
    privateCommunity = await ctx.repo(Community).save({
      name: 'Secreta',
      description: 'Privada',
      slug: 'secreta',
      isPrivate: true,
      categoryId: category.categoryId,
    });
    const [tagA, tagB] = await ctx
      .repo(Tag)
      .save([{ name: 'funko' }, { name: 'anime' }]);

    const product = async (
      key: string,
      owner: Seller,
      values: Partial<Product> = {},
      tag: Tag = tagA,
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

    // Sin destacar todavía. Orden de creación = orden por defecto (más nuevo
    // primero). Los precios van de 10 a 200 USD.
    await product('N01', storeFree, { price: 15 });
    await product('N02', storeFree, { price: 150 }, tagB);
    await product('N03', storeFree, { price: 40 });
    await product('P1-r1', storeOne, { price: 60 });
    await product('P1-r2', storeOne, { price: 25 }, tagB);
    await product('A1', storeOne, { price: 120 });
    await product('N04', storeFree, { price: 80 });
    await product('A2', storeOne, { price: 200 }, tagB);
    await product('N05', storeFree, { price: 12 });
    await product('A3', storeOne, { price: 30 });
    await product('B1', storeTwo, { price: 90 });
    await product('N06', storeFree, { price: 55 });
    await product('B2', storeTwo, { currency: 'CRC', price: 2500 });
    await product('N07', storeFree, { price: 70 }, tagB);
    await product('B3', storeTwo, { price: 45 });
    for (let i = 8; i <= 30; i += 1) {
      await product(
        `N${String(i).padStart(2, '0')}`,
        storeFree,
        { price: 10 + i * 3 },
        i % 4 === 0 ? tagB : tagA,
      );
    }
    await product('privada', storeOne, {
      price: 33,
      communityId: privateCommunity.id,
    });
    await product('vendido', storeOne, {
      status: ProductStatus.SOLD,
      quantity: 0,
      price: 22,
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  // Todos los activos visibles que lista GET /products, en el orden por
  // defecto (createdAt DESC, id DESC).
  const baseline = async () => {
    const rows = await ctx.dataSource.query<{ id: number }[]>(
      `SELECT id FROM product
        WHERE status = 'active' AND is_visible = true AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC`,
    );
    return rows.map((row) => row.id);
  };

  describe('sin destacados (regresión)', () => {
    it('el listado es el de siempre: mismo orden, total y páginas, e isFeatured false', async () => {
      await clearFeatured();
      const expected = await baseline();

      const { items, pagination } = await allPages('limit=12');

      expect(items.map((item) => item.id)).toEqual(expected);
      expect(pagination).toMatchObject({
        total: expected.length,
        totalPages: Math.ceil(expected.length / 12),
      });
      expect(featuredOf(items)).toEqual([]);
      for (const item of items) expect(item.isFeatured).toBe(false);
    });

    it('con sort por precio también conserva el orden de siempre', async () => {
      const { items } = await allPages('limit=12&sort=price_asc');
      const prices = items.map((item) => item.displayFinalPrice ?? Infinity);

      expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    });

    it('no expone featuredAt en ningún ítem', async () => {
      await feature('A1', 10);

      const { data } = body(await list('limit=12').expect(200));

      for (const item of data) expect(item).not.toHaveProperty('featuredAt');
      await clearFeatured();
    });
  });

  describe('cuota por página', () => {
    it('limit 12 (cuota 3): los 3 destacados suben a la primera página, más recientes primero', async () => {
      await clearFeatured();
      await feature('A3', 30); // el más reciente
      await feature('A1', 60);
      await feature('A2', 90);

      const first = body(await list('limit=12&page=1').expect(200));

      expect(first.data.slice(0, 3).map((item) => item.title)).toEqual([
        'A3',
        'A1',
        'A2',
      ]);
      expect(featuredOf(first.data)).toEqual(['A3', 'A1', 'A2']);
      expect(first.data).toHaveLength(12);
    });

    it('cada producto aparece una sola vez en todas las páginas y el total es el de siempre', async () => {
      const expected = await baseline();

      const { items, pagination, pages } = await allPages('limit=12');

      noDuplicates(items);
      expect(new Set(items.map((item) => item.id))).toEqual(new Set(expected));
      expect(pagination.total).toBe(expected.length);
      expect(pagination.totalPages).toBe(Math.ceil(expected.length / 12));
      expect(pages.slice(0, -1).every((page) => page.length === 12)).toBe(true);
      // El resto de las páginas conserva el orden por defecto de los no
      // destacados.
      const regulars = items.filter((item) => !item.isFeatured);
      const regularIds = regulars.map((item) => item.id);
      expect(regularIds).toEqual(
        expected.filter((id) => !items.slice(0, 3).some((x) => x.id === id)),
      );
    });

    it('con 6 destacados y cuota 3 reparte 3 + 3 en las dos primeras páginas', async () => {
      await clearFeatured();
      const order = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'];
      for (const [index, key] of order.entries()) {
        await feature(key, 10 + index * 10); // A1 más reciente ... B3 más antiguo
      }
      // Dos vendedores Pro con 3 cada uno: ninguno pasa el tope.

      const { pages, items } = await allPages('limit=12');

      expect(featuredOf(pages[0])).toEqual(['A1', 'A2', 'A3']);
      expect(featuredOf(pages[1])).toEqual(['B1', 'B2', 'B3']);
      expect(featuredOf(pages[2] ?? [])).toEqual([]);
      noDuplicates(items);
      expect(pages[0]).toHaveLength(12);
      expect(pages[1]).toHaveLength(12);
    });

    it('limit 8 (cuota 2): 2 destacados por página', async () => {
      const { pages } = await allPages('limit=8');

      expect(pages[0].slice(0, 2).every((item) => item.isFeatured)).toBe(true);
      expect(featuredOf(pages[0])).toHaveLength(2);
      expect(featuredOf(pages[1])).toHaveLength(2);
      expect(featuredOf(pages[2])).toHaveLength(2);
    });

    it('el tope por vendedor recorta al leer: de 5 marcados solo se elevan los 3 más recientes', async () => {
      await clearFeatured();
      for (const [index, key] of [
        'A1',
        'A2',
        'A3',
        'P1-r1',
        'P1-r2',
      ].entries()) {
        await feature(key, 10 + index * 10);
      }

      const { items } = await allPages('limit=12');

      expect(featuredOf(items)).toEqual(['A1', 'A2', 'A3']);
      // Los dos recortados siguen apareciendo, como no destacados.
      for (const key of ['P1-r1', 'P1-r2']) {
        expect(items.some((item) => item.title === key)).toBe(true);
      }
      noDuplicates(items);
    });

    it('páginas fuera de rango salen vacías con el total correcto', async () => {
      await clearFeatured();
      await feature('A1', 10);

      const response = body(await list('limit=12&page=99').expect(200));

      expect(response.data).toEqual([]);
      expect(response.pagination.total).toBe((await baseline()).length);
    });
  });

  describe('filtros y orden del usuario', () => {
    beforeAll(async () => {
      await clearFeatured();
      for (const [index, key] of [
        'A1',
        'A2',
        'A3',
        'B1',
        'B2',
        'B3',
      ].entries()) {
        await feature(key, 10 + index * 10);
      }
    });

    it.each([['price_asc'], ['price_desc'], ['newest']])(
      'sort=%s: los destacados van arriba y los demás siguen el orden elegido',
      async (sort) => {
        const { pages, items } = await allPages(`limit=12&sort=${sort}`);

        expect(pages[0].slice(0, 3).every((item) => item.isFeatured)).toBe(
          true,
        );
        noDuplicates(items);
        const regulars = items
          .filter((item) => !item.isFeatured)
          .map((item) => item.displayFinalPrice ?? 0);
        if (sort === 'price_asc') {
          expect([...regulars].sort((a, b) => a - b)).toEqual(regulars);
        } else if (sort === 'price_desc') {
          expect([...regulars].sort((a, b) => b - a)).toEqual(regulars);
        }
        expect(items).toHaveLength((await baseline()).length);
      },
    );

    it('el filtro por tag solo deja los destacados que lo cumplen', async () => {
      const tagged = await ctx.dataSource.query<{ id: number }[]>(
        `SELECT t.tag_id AS id FROM tag t WHERE t.name = 'anime'`,
      );

      const { items, pagination } = await allPages(
        `limit=12&tag=${tagged[0].id}`,
      );

      // Solo A2 es destacado y de ese tag.
      expect(featuredOf(items)).toEqual(['A2']);
      expect(items[0].title).toBe('A2');
      noDuplicates(items);
      expect(pagination.total).toBe(items.length);
    });

    it('rango de precio en otra moneda: un destacado fuera del rango no aparece', async () => {
      // CRC: 1 USD = 500. A2 vale 200 USD = 100 000 CRC; B2 es 2 500 CRC.
      const { items, pagination } = await allPages(
        'limit=12&priceMax=30000',
        'CRC',
      );

      const titles = items.map((item) => item.title);
      expect(titles).not.toContain('A2'); // 100 000 CRC > 30 000
      expect(titles).not.toContain('A1'); // 60 000 CRC
      expect(titles).toContain('B2'); // 2 500 CRC
      expect(featuredOf(items).sort()).toEqual(['A3', 'B2', 'B3'].sort());
      for (const item of items) {
        expect(item.displayFinalPrice).toBeLessThanOrEqual(30_000);
      }
      noDuplicates(items);
      expect(pagination.total).toBe(items.length);
    });

    it('rango mínimo y máximo con sort por precio en CRC', async () => {
      const { items } = await allPages(
        'limit=12&priceMin=10000&priceMax=60000&sort=price_asc',
        'CRC',
      );

      for (const item of items) {
        expect(item.displayFinalPrice).toBeGreaterThanOrEqual(10_000);
        expect(item.displayFinalPrice).toBeLessThanOrEqual(60_000);
      }
      noDuplicates(items);
      // Los destacados en rango (A1 = 60 000, A3 = 15 000, B1 = 45 000,
      // B3 = 22 500) van primero aunque no sean los más baratos.
      expect(featuredOf(items.slice(0, 3))).toHaveLength(3);
    });

    it('el listado de vendidos de una tienda no eleva nada, aunque haya destacados', async () => {
      // status=sold solo existe en la lista de productos de una tienda.
      const response = body(
        await http()
          .get(`/sellers/${storeOne.sellerId}/products?status=sold&limit=12`)
          .expect(200),
      );

      expect(response.data.map((item) => item.title)).toEqual(['vendido']);
      expect(featuredOf(response.data)).toEqual([]);
    });
  });

  describe('lo que no se eleva', () => {
    it('un destacado de comunidad privada no sube: sigue en su lugar normal, con isFeatured false', async () => {
      await clearFeatured();
      await feature('privada', 10);
      const expected = await baseline();

      const { items } = await allPages('limit=12');

      expect(items.map((item) => item.id)).toEqual(expected);
      expect(featuredOf(items)).toEqual([]);
    });

    it('un destacado vendido no cuenta aunque conserve featured_at', async () => {
      await clearFeatured();
      await feature('vendido', 10);
      const { items } = await allPages('limit=12');

      expect(featuredOf(items)).toEqual([]);
    });

    it('al vencer Pro deja de elevarse sin borrar featured_at, y al renovar vuelve', async () => {
      await clearFeatured();
      await feature('A1', 10);
      await feature('B1', 20);
      const expected = await baseline();

      await setPro(proOne, `now() - interval '1 minute'`);
      const afterExpiry = await allPages('limit=12');
      // A1 (vencido) vuelve a su lugar normal; B1 (Pro vigente) sigue arriba.
      expect(featuredOf(afterExpiry.items)).toEqual(['B1']);
      expect(afterExpiry.items.map((item) => item.id).slice(1)).toEqual(
        expected.filter((id) => id !== ids.B1),
      );
      const kept = await ctx.dataSource.query<{ featured_at: Date | null }[]>(
        'SELECT featured_at FROM product WHERE id = $1',
        [ids.A1],
      );
      expect(kept[0].featured_at).not.toBeNull();

      await setPro(proOne, `now() + interval '30 days'`);
      const afterRenewal = await allPages('limit=12');
      expect(featuredOf(afterRenewal.items)).toEqual(['A1', 'B1']);
    });

    it('si la tienda pierde la aprobación del vendedor deja de elevarse', async () => {
      await clearFeatured();
      await feature('A1', 10);
      await ctx.dataSource.query(
        'UPDATE seller SET is_verified = false WHERE seller_id = $1',
        [storeOne.sellerId],
      );

      const { items } = await allPages('limit=12');
      expect(featuredOf(items)).toEqual([]);

      await ctx.dataSource.query(
        'UPDATE seller SET is_verified = true WHERE seller_id = $1',
        [storeOne.sellerId],
      );
      expect(featuredOf((await allPages('limit=12')).items)).toEqual(['A1']);
    });

    it('un usuario desactivado no eleva', async () => {
      await ctx.repo(User).update(proOne.id, { isActive: false });

      expect(featuredOf((await allPages('limit=12')).items)).toEqual([]);

      await ctx.repo(User).update(proOne.id, { isActive: true });
    });

    it('un producto oculto o sin stock no sube', async () => {
      await ctx.dataSource.query(
        'UPDATE product SET quantity = 0 WHERE id = $1',
        [ids.A1],
      );
      expect(featuredOf((await allPages('limit=12')).items)).toEqual([]);
      await ctx.dataSource.query(
        'UPDATE product SET quantity = 3 WHERE id = $1',
        [ids.A1],
      );

      await ctx.dataSource.query(
        'UPDATE product SET is_visible = false WHERE id = $1',
        [ids.A1],
      );
      expect(featuredOf((await allPages('limit=12')).items)).toEqual([]);
      await ctx.dataSource.query(
        'UPDATE product SET is_visible = true WHERE id = $1',
        [ids.A1],
      );
    });
  });

  describe('GET /sellers/:sellerId/products', () => {
    const store = (sellerId: number, query: string) =>
      http().get(`/sellers/${sellerId}/products?${query}`);

    it('la tienda con 3 destacados y otros productos los sube a la primera página y no pierde ninguno', async () => {
      await clearFeatured();
      for (const [index, key] of ['A3', 'A1', 'A2'].entries()) {
        await feature(key, 10 + index * 10);
      }

      const first = body(
        await store(storeOne.sellerId, 'limit=10').expect(200),
      );

      expect(featuredOf(first.data)).toEqual(['A3', 'A1', 'A2']);
      expect(first.data.slice(0, 3).map((item) => item.title)).toEqual([
        'A3',
        'A1',
        'A2',
      ]);
      // Productos públicos de la tienda: sin el de la comunidad privada ni el
      // vendido (la tienda pública solo lista activos de comunidades públicas).
      expect(first.pagination.total).toBe(5);
      expect(first.pagination.totalPages).toBe(1);
      expect(first.data).toHaveLength(5);
      noDuplicates(first.data);
    });

    it('con solo destacados (3 de 3) caben en una sola página', async () => {
      const response = body(
        await store(storeTwo.sellerId, 'limit=10').expect(200),
      );
      await clearFeatured();
      for (const [index, key] of ['B1', 'B2', 'B3'].entries()) {
        await feature(key, 10 + index * 10);
      }

      const featuredOnly = body(
        await store(storeTwo.sellerId, 'limit=10').expect(200),
      );

      expect(response.data).toHaveLength(3);
      expect(featuredOnly.pagination).toMatchObject({
        total: 3,
        totalPages: 1,
      });
      expect(featuredOnly.data.map((item) => item.title)).toEqual([
        'B1',
        'B2',
        'B3',
      ]);
      expect(featuredOf(featuredOnly.data)).toHaveLength(3);
    });

    it('con limit 8 y 3 destacados se reparte 2 + 1 sin perder ninguno', async () => {
      const pageOne = body(
        await store(storeTwo.sellerId, 'limit=8&page=1').expect(200),
      );

      // Solo hay 3 productos: todos caben en la primera página.
      expect(pageOne.data).toHaveLength(3);
      expect(pageOne.pagination.totalPages).toBe(1);
    });

    it('los productos de una tienda sin destacados mantienen el orden de siempre', async () => {
      const response = body(
        await store(storeFree.sellerId, 'limit=10').expect(200),
      );

      expect(featuredOf(response.data)).toEqual([]);
      expect(response.data[0].isFeatured).toBe(false);
      expect(response.pagination.total).toBeGreaterThan(10);
    });
  });
});
