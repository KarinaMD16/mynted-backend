import request from 'supertest';
import { Category } from '../src/community/entities/category.entity';
import { Community } from '../src/community/entities/community.entity';
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
 * Marcar y quitar destacados (PUT/DELETE /products/:id/featured) y el resumen
 * contra Postgres real: dueño, vendedor aprobado, Pro, producto activo, tope
 * de 3, idempotencia, vencimiento y concurrencia.
 */
jest.setTimeout(90_000);

interface FeaturedBody {
  productId: number;
  featuredEnabled: boolean;
  isFeatured: boolean;
  featuredAt: string;
  message?: string;
  limit?: number;
  used?: number;
  remaining?: number;
}
const json = (response: { body: unknown }) => response.body as FeaturedBody;

describe('Destacados: marcar, quitar y resumen (e2e)', () => {
  let ctx: NotificationsTestApp;
  let pro: User;
  let free: User;
  let unverified: User;
  let buyer: User;
  let proStore: Seller;
  let freeStore: Seller;
  let privateCommunity: Community;
  const ids: Record<string, number> = {};

  const http = () => request(ctx.app.getHttpServer());
  const as = (user: User) => ({
    put: (path: string) => http().put(path).set('Cookie', ctx.cookieFor(user)),
    del: (path: string) =>
      http().delete(path).set('Cookie', ctx.cookieFor(user)),
    get: (path: string) => http().get(path).set('Cookie', ctx.cookieFor(user)),
  });
  const mark = (user: User, key: string) =>
    as(user).put(`/products/${ids[key]}/featured`);
  const featuredAtOf = async (key: string): Promise<Date | null> => {
    const rows = await ctx.dataSource.query<{ featured_at: Date | null }[]>(
      'SELECT featured_at FROM product WHERE id = $1',
      [ids[key]],
    );
    return rows[0].featured_at;
  };
  const clearAll = () =>
    ctx.dataSource.query('UPDATE product SET featured_at = NULL');
  const summaryOf = async (user: User) =>
    json(await as(user).get('/products/me/featured/summary').expect(200));

  beforeAll(async () => {
    ctx = await createNotificationsTestApp([ProductsModule]);

    const users = ctx.repo(User);
    const seller = (name: string, approved = true) =>
      users.create({
        email: `${name}@e2e.test`,
        username: name,
        role: UserRole.SELLER,
        sellerRequestStatus: approved
          ? SellerRequestStatus.APPROVED
          : SellerRequestStatus.PENDING,
        currency: 'USD',
      });
    [pro, free, unverified, buyer] = await users.save([
      seller('feat_pro'),
      seller('feat_free'),
      seller('feat_unverified', false),
      users.create({ email: 'buyer@e2e.test', username: 'feat_buyer' }),
    ]);

    const newStore = async (user: User, isVerified: boolean) => {
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
        isVerified,
      });
    };
    proStore = await newStore(pro, true);
    freeStore = await newStore(free, true);
    const unverifiedStore = await newStore(unverified, false);

    // Pro para el vendedor Pro y para el no verificado (el rol de vendedor
    // sigue siendo requisito aunque tenga Pro).
    for (const user of [pro, unverified]) {
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
      ids[key] = saved.id;
    };
    for (const key of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
      await product(key, proStore);
    }
    await product('draft', proStore, { status: ProductStatus.DRAFT });
    await product('inactive', proStore, { status: ProductStatus.INACTIVE });
    await product('sold', proStore, {
      status: ProductStatus.SOLD,
      quantity: 0,
    });
    await product('privada', proStore, { communityId: privateCommunity.id });
    await product('free-1', freeStore);
    await product('unverified-1', unverifiedStore);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('permisos y validaciones', () => {
    it('exige sesión', async () => {
      await http().put(`/products/${ids.A}/featured`).expect(401);
      await http().delete(`/products/${ids.A}/featured`).expect(401);
      await http().get('/products/me/featured/summary').expect(401);
    });

    it('404 si el producto no existe o es de otro vendedor, sin revelar cuál', async () => {
      const missing = await as(pro)
        .put('/products/999999/featured')
        .expect(404);
      const others = await mark(pro, 'free-1').expect(404);

      expect(json(missing)).toMatchObject({
        message: 'Producto no encontrado',
      });
      expect(json(others)).toMatchObject({ message: 'Producto no encontrado' });
      await as(pro).del(`/products/${ids['free-1']}/featured`).expect(404);
      await as(pro).del('/products/999999/featured').expect(404);
      await as(pro).put('/products/abc/featured').expect(400);
    });

    it('403 si es vendedor aprobado pero no tiene Pro vigente', async () => {
      await mark(free, 'free-1').expect(403);
      expect(await featuredAtOf('free-1')).toBeNull();
    });

    it('403 si tiene Pro pero la tienda no está aprobada', async () => {
      await mark(unverified, 'unverified-1').expect(403);
      expect(await featuredAtOf('unverified-1')).toBeNull();
    });

    it('un usuario que no es vendedor no puede ver el resumen (403)', async () => {
      await as(buyer).get('/products/me/featured/summary').expect(403);
    });

    it.each(['draft', 'inactive', 'sold'])(
      '409 si el producto está %s',
      async (key) => {
        const response = await mark(pro, key).expect(409);

        expect(json(response)).toMatchObject({
          message: 'Solo se pueden destacar productos activos',
        });
        expect(await featuredAtOf(key)).toBeNull();
      },
    );
  });

  describe('tope de 3 e idempotencia', () => {
    it('el resumen empieza vacío', async () => {
      await expect(summaryOf(pro)).resolves.toEqual({
        limit: 3,
        used: 0,
        remaining: 3,
      });
    });

    it('marca hasta 3 y el cuarto es 409 con un mensaje claro', async () => {
      for (const key of ['A', 'B', 'C']) {
        const response = await mark(pro, key).expect(200);
        expect(json(response)).toMatchObject({
          productId: ids[key],
          featuredEnabled: true,
          isFeatured: true,
        });
        // La fecha de la respuesta es la que quedó guardada.
        expect(json(response).featuredAt).toBe(
          (await featuredAtOf(key))?.toISOString(),
        );
      }

      const fourth = await mark(pro, 'D').expect(409);

      expect(json(fourth).message).toBe(
        'Ya tienes 3 productos destacados. Quita uno para destacar otro',
      );
      expect(await featuredAtOf('D')).toBeNull();
      await expect(summaryOf(pro)).resolves.toEqual({
        limit: 3,
        used: 3,
        remaining: 0,
      });
    });

    it('marcar uno que ya estaba destacado responde 200, no cambia featured_at y no cuenta dos veces', async () => {
      const before = await featuredAtOf('A');

      const response = await mark(pro, 'A').expect(200);

      expect(await featuredAtOf('A')).toEqual(before);
      expect(json(response).featuredAt).toBe(before?.toISOString());
      await expect(summaryOf(pro)).resolves.toMatchObject({ used: 3 });
    });

    it('quitar uno libera un cupo; quitarlo otra vez es 204', async () => {
      await as(pro).del(`/products/${ids.B}/featured`).expect(204);
      await as(pro).del(`/products/${ids.B}/featured`).expect(204);

      expect(await featuredAtOf('B')).toBeNull();
      await expect(summaryOf(pro)).resolves.toEqual({
        limit: 3,
        used: 2,
        remaining: 1,
      });

      await mark(pro, 'D').expect(200);
      await expect(summaryOf(pro)).resolves.toMatchObject({ used: 3 });
    });

    it('quitar no exige Pro: el vendedor sin Pro puede limpiar su preferencia', async () => {
      await ctx.dataSource.query(
        'UPDATE product SET featured_at = now() WHERE id = $1',
        [ids['free-1']],
      );

      await as(free).del(`/products/${ids['free-1']}/featured`).expect(204);

      expect(await featuredAtOf('free-1')).toBeNull();
    });
  });

  describe('vencimiento de Pro', () => {
    it('deja de contar sin borrar featured_at, no deja marcar y al renovar vuelve', async () => {
      const keptA = await featuredAtOf('A');
      await ctx.dataSource.query(
        `UPDATE subscription SET ends_at = now() - interval '1 minute' WHERE user_id = $1`,
        [pro.id],
      );

      await expect(summaryOf(pro)).resolves.toMatchObject({
        used: 0,
        remaining: 3,
      });
      expect(await featuredAtOf('A')).toEqual(keptA);
      await mark(pro, 'E').expect(403);

      await ctx.dataSource.query(
        `UPDATE subscription SET ends_at = now() + interval '30 days' WHERE user_id = $1`,
        [pro.id],
      );

      await expect(summaryOf(pro)).resolves.toMatchObject({ used: 3 });
      expect(await featuredAtOf('A')).toEqual(keptA);
    });
  });

  describe('lo que no se eleva no consume cupo', () => {
    it('un producto de comunidad privada se puede marcar pero no cuenta ni se eleva', async () => {
      await clearAll();

      const response = await mark(pro, 'privada').expect(200);

      expect(json(response)).toMatchObject({
        featuredEnabled: true,
        isFeatured: false,
      });
      await expect(summaryOf(pro)).resolves.toMatchObject({ used: 0 });
      for (const key of ['A', 'B', 'C']) await mark(pro, key).expect(200);
      await expect(summaryOf(pro)).resolves.toMatchObject({ used: 3 });
    });

    it('un producto vendido conserva featured_at y libera el cupo', async () => {
      await clearAll();
      for (const key of ['A', 'B', 'C']) await mark(pro, key).expect(200);
      const keptC = await featuredAtOf('C');

      await ctx.dataSource.query(
        `UPDATE product SET status = 'sold', quantity = 0 WHERE id = $1`,
        [ids.C],
      );

      await expect(summaryOf(pro)).resolves.toMatchObject({
        used: 2,
        remaining: 1,
      });
      expect(await featuredAtOf('C')).toEqual(keptC);
      await mark(pro, 'D').expect(200);

      // Al reponerlo vuelve a estar activo y supera el tope: se recorta.
      await ctx.dataSource.query(
        `UPDATE product SET status = 'active', quantity = 3 WHERE id = $1`,
        [ids.C],
      );
      await expect(summaryOf(pro)).resolves.toMatchObject({
        used: 3,
        remaining: 0,
      });
    });

    it('perder el rol o la aprobación de la tienda deja de elevarlos sin tocar la preferencia', async () => {
      await clearAll();
      for (const key of ['A', 'B']) await mark(pro, key).expect(200);
      await ctx.dataSource.query(
        'UPDATE seller SET is_verified = false WHERE seller_id = $1',
        [proStore.sellerId],
      );

      const rows = await ctx.dataSource.query<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM product WHERE seller_id = $1 AND featured_at IS NOT NULL`,
        [proStore.sellerId],
      );
      expect(rows[0].n).toBe(2);
      await mark(pro, 'C').expect(403);

      await ctx.dataSource.query(
        'UPDATE seller SET is_verified = true WHERE seller_id = $1',
        [proStore.sellerId],
      );
      await expect(summaryOf(pro)).resolves.toMatchObject({ used: 2 });
    });
  });

  describe('concurrencia', () => {
    it('cinco PUT simultáneos del mismo vendedor no se pasan del tope', async () => {
      await clearAll();

      const responses = await Promise.all(
        ['A', 'B', 'C', 'D', 'E'].map((key) => mark(pro, key)),
      );

      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([200, 200, 200, 409, 409]);
      await expect(summaryOf(pro)).resolves.toMatchObject({ used: 3 });
    });

    it('dos PUT simultáneos del mismo producto responden 200 con la misma fecha', async () => {
      await clearAll();

      const [a, b] = await Promise.all([mark(pro, 'F'), mark(pro, 'F')]);

      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(typeof json(a).featuredAt).toBe('string');
      expect(json(a).featuredAt).toBe(json(b).featuredAt);
      expect(json(a).featuredAt).toBe((await featuredAtOf('F'))?.toISOString());
      await expect(summaryOf(pro)).resolves.toMatchObject({ used: 1 });
    });
  });
});
