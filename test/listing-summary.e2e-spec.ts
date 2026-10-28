import request from 'supertest';
import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner';
import { Tag } from '../src/community/entities/tag.entity';
import { Conversation } from '../src/conversations/entities/conversation.entity';
import { Message } from '../src/conversations/entities/message.entity';
import { MessageType } from '../src/conversations/enums/message-type.enum';
import { ProductTag } from '../src/products/entities/product-tag.entity';
import {
  Product,
  ProductCondition,
  ProductStatus,
  ProductType,
} from '../src/products/entities/product.entity';
import { Review } from '../src/products/entities/review.entity';
import { ProductsModule } from '../src/products/products.module';
import { ReputationModule } from '../src/reputation/reputation.module';
import { SearchModule } from '../src/search/search.module';
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
 * isPro + frame (resumen liviano) en todas las superficies, con datos reales:
 *  - Pro vigente con un marco Pro equipado (frame_gold)
 *  - Pro vencido que conserva el marco Pro equipado en su fila (cae al marco
 *    por defecto: ya no tiene derecho a usarlo)
 *  - gratuito con un marco gratuito equipado (frame_simple)
 *  - gratuito sin preferencias (marco por defecto)
 * y el costo de cada lista: una consulta de suscripciones, una de preferencias
 * y una del catálogo, sin importar cuántos usuarios traiga.
 */
jest.setTimeout(90_000);

type Frame = { code: string; assetUrl: string | null };
type Summary = { isPro: boolean; frame: Frame };

const json = (response: { body: unknown }) =>
  response.body as Record<string, unknown>;

const DEFAULT: Frame = { code: 'frame_default', assetUrl: null };

describe('isPro y frame en los listados (e2e)', () => {
  let ctx: NotificationsTestApp;
  let proUser: User;
  let expiredUser: User;
  let freeFramed: User;
  let freePlain: User;
  let viewer: User;
  let proProduct: Product;
  let proConversation: Conversation;

  const http = () => request(ctx.app.getHttpServer());
  const asViewer = (path: string, user: User = viewer) =>
    http().get(path).set('Cookie', ctx.cookieFor(user));

  // Consultas que dispara una petición, por tabla (la tabla de cosméticos se
  // cuenta aparte de las preferencias del usuario).
  const queriesFor = async (run: () => Promise<unknown>) => {
    // Todas las consultas (repositorios y SQL directo) pasan por el query
    // runner de Postgres.
    const spy = jest.spyOn(PostgresQueryRunner.prototype, 'query');
    try {
      await run();
      const sqls = spy.mock.calls
        .map(([sql]) => sql)
        .filter((sql): sql is string => typeof sql === 'string');
      return {
        subscription: sqls.filter((sql) => sql.includes('FROM subscription'))
          .length,
        userCosmetics: sqls.filter((sql) =>
          sql.includes('FROM "user_cosmetics"'),
        ).length,
        catalog: sqls.filter((sql) => /FROM "cosmetic"/.test(sql)).length,
      };
    } finally {
      spy.mockRestore();
    }
  };

  const summaryOf = (value: Summary) => ({
    isPro: value.isPro,
    frame: value.frame.code,
  });

  const EXPECTED = (): Record<string, { isPro: boolean; frame: string }> => ({
    [proUser.id]: { isPro: true, frame: 'frame_gold' },
    [expiredUser.id]: { isPro: false, frame: 'frame_default' },
    [freeFramed.id]: { isPro: false, frame: 'frame_simple' },
    [freePlain.id]: { isPro: false, frame: 'frame_default' },
  });

  beforeAll(async () => {
    ctx = await createNotificationsTestApp([
      UsersModule,
      ProductsModule,
      SellersPublicModule,
      ReputationModule,
      SearchModule,
    ]);

    const users = ctx.repo(User);
    const seller = (name: string) =>
      users.create({
        email: `${name}@e2e.test`,
        username: name,
        role: UserRole.SELLER,
        sellerRequestStatus: SellerRequestStatus.APPROVED,
        currency: 'CRC',
      });
    [proUser, expiredUser, freeFramed, freePlain, viewer] = await users.save([
      seller('lst_pro'),
      seller('lst_expired'),
      seller('lst_free_framed'),
      seller('lst_free_plain'),
      users.create({ email: 'lst-viewer@e2e.test', username: 'lst_viewer' }),
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
        description: 'Funkos originales',
        location: 'San José',
        userId: user.id,
        paymentId: paymentInfo.paymentInfoId,
        isVerified: true,
      });
    };
    const proStore = await newStore(proUser);
    const expiredStore = await newStore(expiredUser);
    const framedStore = await newStore(freeFramed);
    const plainStore = await newStore(freePlain);

    const day = 24 * 3600_000;
    const subscribe = (user: User, endsAt: Date) =>
      ctx.repo(Subscription).save({
        userId: user.id,
        period: SubscriptionPeriod.MONTHLY,
        startsAt: new Date(Date.now() - 10 * day),
        endsAt,
        cancelAtPeriodEnd: false,
      });
    await subscribe(proUser, new Date(Date.now() + 20 * day));
    await subscribe(expiredUser, new Date(Date.now() - day));

    const equip = (user: User, code: string) =>
      ctx.dataSource.query(
        `INSERT INTO user_cosmetics (user_id, frame_cosmetic_id)
         SELECT $1, id FROM cosmetic WHERE code = $2`,
        [user.id, code],
      );
    await equip(proUser, 'frame_gold');
    // El vencido conserva su fila con el marco Pro equipado.
    await equip(expiredUser, 'frame_gold');
    await equip(freeFramed, 'frame_simple');

    const tag = await ctx.repo(Tag).save({ name: 'funko' });
    const product = async (title: string, owner: Seller) => {
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
        sellerId: owner.sellerId,
      });
      await ctx
        .repo(ProductTag)
        .save({ productId: saved.id, tagId: tag.tagId });
      return saved;
    };
    proProduct = await product('Producto del Pro', proStore);
    await product('Producto del vencido', expiredStore);
    await product('Producto del gratuito', framedStore);
    await product('Producto sin marco', plainStore);

    // Reseñas de los cuatro autores en el mismo producto.
    await ctx.repo(Review).save(
      [proUser, expiredUser, freeFramed, freePlain].map((author) => ({
        productId: proProduct.id,
        authorId: author.id,
        rating: 5,
        comment: `reseña de ${author.username}`,
      })),
    );

    const conversation = async (owner: User, forProduct: Product) => {
      const saved = await ctx.repo(Conversation).save({
        buyerId: viewer.id,
        sellerId: owner.id,
        productId: forProduct.id,
      });
      await ctx.repo(Message).save({
        conversationId: saved.id,
        senderId: owner.id,
        type: MessageType.TEXT,
        content: 'hola',
      });
      return saved;
    };
    proConversation = await conversation(proUser, proProduct);
    await conversation(expiredUser, proProduct);
    await conversation(freeFramed, proProduct);
    await conversation(freePlain, proProduct);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('perfil público y búsqueda de usuarios', () => {
    it('GET /users/:id trae isPro y frame (y frame coincide con cosmetics.frame)', async () => {
      for (const [id, expected] of Object.entries(EXPECTED())) {
        const body = json(await asViewer(`/users/${id}`).expect(200)) as {
          isPro: boolean;
          frame: Frame;
          cosmetics: { frame: Frame };
        };
        expect(summaryOf(body)).toEqual(expected);
        expect(body.cosmetics.frame).toEqual(body.frame);
      }
    });

    it('un usuario sin preferencias recibe el marco por defecto con assetUrl null', async () => {
      const body = json(await asViewer(`/users/${freePlain.id}`).expect(200));

      expect(body.frame).toEqual(DEFAULT);
    });

    it('GET /users/search resuelve la lista con una consulta por tabla', async () => {
      let response: request.Response | undefined;
      const queries = await queriesFor(async () => {
        response = await asViewer('/users/search?q=lst_').expect(200);
      });

      const data = json(response!).data as (Summary & { id: string })[];
      expect(data).toHaveLength(5);
      const byId = Object.fromEntries(
        data.map((user) => [user.id, summaryOf(user)]),
      );
      expect(byId).toMatchObject(EXPECTED());
      expect(byId[viewer.id]).toEqual({ isPro: false, frame: 'frame_default' });
      expect(queries).toEqual({
        subscription: 1,
        userCosmetics: 1,
        catalog: 1,
      });
    });

    it('GET /users/me conserva cosmetics y isPro', async () => {
      const body = json(await asViewer('/users/me', proUser).expect(200)) as {
        isPro: boolean;
        cosmetics: { frame: Frame };
      };

      expect(body.isPro).toBe(true);
      expect(body.cosmetics.frame.code).toBe('frame_gold');
    });
  });

  describe('tienda', () => {
    it('GET /sellers/:sellerId trae isPro y frame', async () => {
      const sellers = await ctx.repo(Seller).find();
      const sellerIdOf = (user: User) =>
        sellers.find((seller) => seller.userId === user.id)!.sellerId;

      for (const [id, expected] of Object.entries(EXPECTED())) {
        const user = [proUser, expiredUser, freeFramed, freePlain].find(
          (candidate) => candidate.id === id,
        )!;
        const body = json(
          await http()
            .get(`/sellers/${sellerIdOf(user)}`)
            .expect(200),
        ) as Summary;
        expect(summaryOf(body)).toEqual(expected);
      }
    });

    it('GET /search?type=stores resuelve la lista con una consulta por tabla', async () => {
      let response: request.Response | undefined;
      const queries = await queriesFor(async () => {
        response = await http().get('/search?type=stores&q=Tienda').expect(200);
      });

      const data = json(response!).data as (Summary & { userId: string })[];
      expect(data).toHaveLength(4);
      expect(
        Object.fromEntries(
          data.map((store) => [store.userId, summaryOf(store)]),
        ),
      ).toEqual(EXPECTED());
      expect(queries).toEqual({
        subscription: 1,
        userCosmetics: 1,
        catalog: 1,
      });
    });
  });

  describe('productos', () => {
    it('las tarjetas del Shop traen seller.isPro y seller.frame con una consulta por tabla', async () => {
      let response: request.Response | undefined;
      const queries = await queriesFor(async () => {
        response = await http().get('/products/shop').expect(200);
      });

      const sections = json(response!).sections as {
        products: { seller: Summary & { userId: string } }[];
      }[];
      const cards = sections.flatMap((section) => section.products);
      expect(cards).toHaveLength(4);
      expect(
        Object.fromEntries(
          cards.map((card) => [card.seller.userId, summaryOf(card.seller)]),
        ),
      ).toEqual(EXPECTED());
      expect(queries).toEqual({
        subscription: 1,
        userCosmetics: 1,
        catalog: 1,
      });
    });

    it('el detalle trae seller.isPro y seller.frame', async () => {
      const body = json(
        await http().get(`/products/${proProduct.id}`).expect(200),
      ) as { seller: Summary };

      expect(summaryOf(body.seller)).toEqual({
        isPro: true,
        frame: 'frame_gold',
      });
    });

    it('los listados sin objeto seller no cambian', async () => {
      const data = json(await http().get('/products').expect(200))
        .data as Record<string, unknown>[];

      expect(data.length).toBeGreaterThan(0);
      for (const item of data) {
        expect(item).not.toHaveProperty('frame');
        expect(item).not.toHaveProperty('seller');
      }
    });
  });

  describe('reseñas', () => {
    it('GET /products/:id/reviews trae author.isPro y author.frame con una consulta por tabla', async () => {
      let response: request.Response | undefined;
      const queries = await queriesFor(async () => {
        response = await asViewer(`/products/${proProduct.id}/reviews`).expect(
          200,
        );
      });

      const data = json(response!).data as {
        author: Summary & { id: string };
      }[];
      expect(data).toHaveLength(4);
      expect(
        Object.fromEntries(
          data.map((review) => [review.author.id, summaryOf(review.author)]),
        ),
      ).toEqual(EXPECTED());
      expect(queries).toEqual({
        subscription: 1,
        userCosmetics: 1,
        catalog: 1,
      });
    });
  });

  describe('reputación', () => {
    it('GET /profiles/:id/reputation trae isPro y frame', async () => {
      for (const [id, expected] of Object.entries(EXPECTED())) {
        const body = json(
          await asViewer(`/profiles/${id}/reputation`).expect(200),
        ) as Summary;
        expect(summaryOf(body)).toEqual(expected);
      }
    });
  });

  describe('chat', () => {
    it('la bandeja trae isPro y frame del otro participante con una consulta por tabla', async () => {
      let response: request.Response | undefined;
      const queries = await queriesFor(async () => {
        response = await asViewer('/conversations').expect(200);
      });

      const data = json(response!).data as {
        otherParticipant: Summary & { id: string };
      }[];
      expect(data).toHaveLength(4);
      expect(
        Object.fromEntries(
          data.map((item) => [
            item.otherParticipant.id,
            summaryOf(item.otherParticipant),
          ]),
        ),
      ).toEqual(EXPECTED());
      expect(queries).toEqual({
        subscription: 1,
        userCosmetics: 1,
        catalog: 1,
      });
    });

    it('el historial de mensajes trae isPro y frame del otro participante', async () => {
      const response = await asViewer(
        `/conversations/${proConversation.id}/messages`,
      ).expect(200);

      const conversation = json(response).conversation as {
        otherParticipant: Summary & { id: string };
      };
      expect(conversation.otherParticipant.id).toBe(proUser.id);
      expect(summaryOf(conversation.otherParticipant)).toEqual({
        isPro: true,
        frame: 'frame_gold',
      });
    });
  });

  it('al vencer la suscripción el marco Pro equipado cae al por defecto en todas partes, sin tocar la fila', async () => {
    await ctx.dataSource.query(
      `UPDATE subscription SET ends_at = now() - interval '1 minute' WHERE user_id = $1`,
      [proUser.id],
    );

    const profile = json(
      await asViewer(`/users/${proUser.id}`).expect(200),
    ) as Summary;
    const reputation = json(
      await asViewer(`/profiles/${proUser.id}/reputation`).expect(200),
    ) as Summary;
    const reviews = json(
      await asViewer(`/products/${proProduct.id}/reviews`).expect(200),
    ).data as { author: Summary & { id: string } }[];

    expect(summaryOf(profile)).toEqual({
      isPro: false,
      frame: 'frame_default',
    });
    expect(summaryOf(reputation)).toEqual(summaryOf(profile));
    expect(
      reviews.find((review) => review.author.id === proUser.id)!.author,
    ).toMatchObject({ isPro: false, frame: DEFAULT });

    // La preferencia guardada no se tocó: si renueva, vuelve el marco.
    const rows: { code: string }[] = await ctx.dataSource.query(
      `SELECT c.code FROM user_cosmetics uc
       JOIN cosmetic c ON c.id = uc.frame_cosmetic_id
       WHERE uc.user_id = $1`,
      [proUser.id],
    );
    expect(rows).toEqual([{ code: 'frame_gold' }]);
  });
});
