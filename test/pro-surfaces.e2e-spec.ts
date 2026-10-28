import request from 'supertest';
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
 * isPro en cada superficie, con suscripciones reales en Postgres: vigente,
 * vencida y sin suscripción. Las listas resuelven isPro con una sola consulta
 * a subscription, sin importar cuántos usuarios traigan.
 */
jest.setTimeout(90_000);

const json = (response: { body: unknown }) =>
  response.body as Record<string, unknown>;

describe('isPro en las superficies (e2e)', () => {
  let ctx: NotificationsTestApp;
  let proSeller: User;
  let expiredSeller: User;
  let freeSeller: User;
  let proFan: User;
  let viewer: User;
  let proStore: Seller;
  let freeStore: Seller;
  let proProduct: Product;
  let freeProduct: Product;
  let proConversation: Conversation;

  const http = () => request(ctx.app.getHttpServer());
  const asViewer = (path: string, user: User = viewer) =>
    http().get(path).set('Cookie', ctx.cookieFor(user));

  // Cuántas consultas a subscription dispara una petición.
  const subscriptionQueries = async (run: () => Promise<unknown>) => {
    const spy = jest.spyOn(ctx.dataSource, 'query');
    try {
      await run();
      return spy.mock.calls.filter(
        ([sql]) => typeof sql === 'string' && sql.includes('FROM subscription'),
      ).length;
    } finally {
      spy.mockRestore();
    }
  };

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
    [proSeller, expiredSeller, freeSeller, proFan, viewer] = await users.save([
      seller('mynted_pro_seller'),
      seller('mynted_expired_seller'),
      seller('mynted_free_seller'),
      users.create({ email: 'fan@e2e.test', username: 'mynted_pro_fan' }),
      users.create({ email: 'viewer@e2e.test', username: 'mynted_viewer' }),
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
    proStore = await newStore(proSeller);
    const expiredStore = await newStore(expiredSeller);
    freeStore = await newStore(freeSeller);

    const day = 24 * 3600_000;
    const subscribe = (user: User, endsAt: Date) =>
      ctx.repo(Subscription).save({
        userId: user.id,
        period: SubscriptionPeriod.MONTHLY,
        startsAt: new Date(Date.now() - 10 * day),
        endsAt,
        cancelAtPeriodEnd: false,
      });
    await subscribe(proSeller, new Date(Date.now() + 20 * day));
    await subscribe(proFan, new Date(Date.now() + 5 * day));
    await subscribe(expiredSeller, new Date(Date.now() - day));
    // Marcos equipados: el Pro uno Pro y el gratuito uno gratuito.
    await ctx.dataSource.query(
      `INSERT INTO user_cosmetics (user_id, frame_cosmetic_id)
       SELECT $1, id FROM cosmetic WHERE code = 'frame_gold'`,
      [proSeller.id],
    );
    await ctx.dataSource.query(
      `INSERT INTO user_cosmetics (user_id, frame_cosmetic_id)
       SELECT $1, id FROM cosmetic WHERE code = 'frame_simple'`,
      [freeSeller.id],
    );

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
    freeProduct = await product('Producto del gratuito', freeStore);

    const conversation = async (owner: User, forProduct: Product) => {
      const saved = await ctx.repo(Conversation).save({
        buyerId: viewer.id,
        sellerId: owner.id,
        productId: forProduct.id,
      });
      await ctx.repo(Message).save({
        conversationId: saved.id,
        senderId: viewer.id,
        type: MessageType.TEXT,
        content: 'hola',
      });
      return saved;
    };
    proConversation = await conversation(proSeller, proProduct);
    await conversation(freeSeller, freeProduct);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('GET /users/me', () => {
    it('Pro vigente: isPro true y conserva el resto de los campos', async () => {
      const response = await asViewer('/users/me', proSeller).expect(200);

      expect(json(response)).toMatchObject({
        id: proSeller.id,
        username: 'mynted_pro_seller',
        role: 'seller',
        isPro: true,
        seller: expect.objectContaining({
          sellerId: proStore.sellerId,
        }) as unknown,
      });
      expect(json(response)).not.toHaveProperty('passwordHash');
    });

    it('sin suscripción o con la suscripción vencida: isPro false', async () => {
      expect(json(await asViewer('/users/me', viewer).expect(200)).isPro).toBe(
        false,
      );
      expect(
        json(await asViewer('/users/me', expiredSeller).expect(200)).isPro,
      ).toBe(false);
    });

    it('un Pro que no es vendedor también tiene isPro', async () => {
      const response = await asViewer('/users/me', proFan).expect(200);

      expect(json(response).isPro).toBe(true);
      expect(json(response)).not.toHaveProperty('seller');
    });
  });

  describe('perfil público y búsqueda de usuarios', () => {
    it('GET /users/:id', async () => {
      expect(
        json(await asViewer(`/users/${proSeller.id}`).expect(200)).isPro,
      ).toBe(true);
      expect(
        json(await asViewer(`/users/${expiredSeller.id}`).expect(200)).isPro,
      ).toBe(false);
    });

    it('GET /users/search resuelve toda la lista con una sola consulta', async () => {
      let response: request.Response | undefined;
      const queries = await subscriptionQueries(async () => {
        response = await asViewer('/users/search?q=mynted').expect(200);
      });

      const data = json(response!).data as {
        username: string;
        isPro: boolean;
      }[];
      expect(data).toHaveLength(5);
      expect(
        Object.fromEntries(data.map((user) => [user.username, user.isPro])),
      ).toEqual({
        mynted_pro_seller: true,
        mynted_expired_seller: false,
        mynted_free_seller: false,
        mynted_pro_fan: true,
        mynted_viewer: false,
      });
      expect(queries).toBe(1);
    });
  });

  describe('tienda', () => {
    it('GET /sellers/:sellerId', async () => {
      expect(
        json(await http().get(`/sellers/${proStore.sellerId}`).expect(200))
          .isPro,
      ).toBe(true);
      expect(
        json(await http().get(`/sellers/${freeStore.sellerId}`).expect(200))
          .isPro,
      ).toBe(false);
    });

    it('GET /search?type=stores resuelve toda la lista con una sola consulta', async () => {
      let response: request.Response | undefined;
      const queries = await subscriptionQueries(async () => {
        response = await http().get('/search?type=stores&q=Tienda').expect(200);
      });

      const data = json(response!).data as { userId: string; isPro: boolean }[];
      expect(data).toHaveLength(3);
      expect(
        Object.fromEntries(data.map((store) => [store.userId, store.isPro])),
      ).toEqual({
        [proSeller.id]: true,
        [expiredSeller.id]: false,
        [freeSeller.id]: false,
      });
      expect(queries).toBe(1);
    });
  });

  describe('productos', () => {
    it('las tarjetas del Shop traen seller.isPro con una sola consulta', async () => {
      let response: request.Response | undefined;
      const queries = await subscriptionQueries(async () => {
        response = await http().get('/products/shop').expect(200);
      });

      const sections = json(response!).sections as {
        products: { title: string; seller: { isPro: boolean } }[];
      }[];
      const cards = sections.flatMap((section) => section.products);
      expect(
        Object.fromEntries(
          cards.map((card) => [card.title, card.seller.isPro]),
        ),
      ).toEqual({
        'Producto del Pro': true,
        'Producto del vencido': false,
        'Producto del gratuito': false,
      });
      expect(queries).toBe(1);
    });

    it('el detalle trae seller.isPro', async () => {
      const pro = await http().get(`/products/${proProduct.id}`).expect(200);
      const free = await http().get(`/products/${freeProduct.id}`).expect(200);

      expect((json(pro).seller as { isPro: boolean }).isPro).toBe(true);
      expect((json(free).seller as { isPro: boolean }).isPro).toBe(false);
    });

    it('los listados sin objeto seller no cambian', async () => {
      const response = await http().get('/products').expect(200);

      const data = json(response).data as Record<string, unknown>[];
      expect(data.length).toBeGreaterThan(0);
      for (const item of data) {
        expect(item).not.toHaveProperty('isPro');
        expect(item).not.toHaveProperty('seller');
      }
    });
  });

  describe('reputación', () => {
    it('GET /profiles/:id/reputation', async () => {
      expect(
        json(await asViewer(`/profiles/${proSeller.id}/reputation`).expect(200))
          .isPro,
      ).toBe(true);
      expect(
        json(
          await asViewer(`/profiles/${freeSeller.id}/reputation`).expect(200),
        ).isPro,
      ).toBe(false);
      expect(
        json(await asViewer(`/profiles/${proFan.id}/reputation`).expect(200)),
      ).toMatchObject({ isSeller: false, isPro: true });
    });
  });

  describe('chat', () => {
    it('la bandeja marca isPro del otro participante con una sola consulta', async () => {
      let response: request.Response | undefined;
      const queries = await subscriptionQueries(async () => {
        response = await asViewer('/conversations').expect(200);
      });

      const data = json(response!).data as {
        otherParticipant: {
          id: string;
          isPro: boolean;
          frame: { code: string };
        };
      }[];
      expect(
        Object.fromEntries(
          data.map((item) => [
            item.otherParticipant.id,
            [item.otherParticipant.isPro, item.otherParticipant.frame.code],
          ]),
        ),
      ).toEqual({
        [proSeller.id]: [true, 'frame_gold'],
        // Un gratuito conserva su marco gratuito.
        [freeSeller.id]: [false, 'frame_simple'],
      });
      expect(queries).toBe(1);
    });

    it('el historial de mensajes marca isPro del otro participante', async () => {
      const response = await asViewer(
        `/conversations/${proConversation.id}/messages`,
      ).expect(200);

      const conversation = json(response).conversation as {
        otherParticipant: { id: string; isPro: boolean; frame: object };
      };
      expect(conversation.otherParticipant).toMatchObject({
        id: proSeller.id,
        isPro: true,
        frame: { code: 'frame_gold' },
      });
    });
  });

  it('al vencer la suscripción isPro pasa a false en todas partes, sin tocar nada más', async () => {
    await ctx.dataSource.query(
      `UPDATE subscription SET ends_at = now() - interval '1 minute' WHERE user_id = $1`,
      [proSeller.id],
    );

    expect(json(await asViewer('/users/me', proSeller).expect(200)).isPro).toBe(
      false,
    );
    expect(
      json(await http().get(`/sellers/${proStore.sellerId}`).expect(200)).isPro,
    ).toBe(false);
    expect(
      json(await asViewer(`/profiles/${proSeller.id}/reputation`).expect(200))
        .isPro,
    ).toBe(false);
  });
});
