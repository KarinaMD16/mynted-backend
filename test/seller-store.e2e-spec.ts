import {
  ClassSerializerInterceptor,
  INestApplication,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import cookieParser from 'cookie-parser';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { CloudinaryService } from '../src/cloudinary/cloudinary.service';
import { Category } from '../src/community/entities/category.entity';
import { Conversation } from '../src/conversations/entities/conversation.entity';
import { Community } from '../src/community/entities/community.entity';
import { Tag } from '../src/community/entities/tag.entity';
import { ExchangeRateService } from '../src/payments/exchange-rate/exchange-rate.service';
import { ProductTag } from '../src/products/entities/product-tag.entity';
import {
  Product,
  ProductCondition,
  ProductStatus,
  ProductType,
} from '../src/products/entities/product.entity';
import { Review } from '../src/products/entities/review.entity';
import { SellersPublicModule } from '../src/sellers-public/sellers-public.module';
import { SellersPublicService } from '../src/sellers-public/sellers-public.service';
import {
  PaymentInfo,
  PaymentType,
} from '../src/sellers/entities/payment-info.entity';
import { Seller } from '../src/sellers/entities/seller.entity';
import { SellersModule } from '../src/sellers/sellers.module';
import {
  SellerRequestStatus,
  User,
  UserRole,
} from '../src/users/entities/user.entity';
import { E2E_DB_NAME } from './e2e-database';

/**
 * Rutas públicas de la tienda (/sellers/:sellerId...) contra Postgres real,
 * junto a SellersModule para comprobar que las rutas de comisión
 * (sellers/me/commission...) siguen respondiendo. Tasas fijas: 1 USD = 500 CRC.
 */
jest.setTimeout(90_000);

describe('Tienda pública del vendedor (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let cookieFor: (user: User) => string;

  let seller: User;
  let pending: User;
  let inactive: User;
  let buyer: User;
  let admin: User;
  let store: Seller;
  let pendingStore: Seller;
  let inactiveStore: Seller;
  let fewStore: Seller;
  const tags: Record<string, number> = {};
  const products: Record<string, number> = {};

  const http = () => request(app.getHttpServer());
  const repo = <T extends object>(entity: new () => T): Repository<T> =>
    dataSource.getRepository(entity);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        EventEmitterModule.forRoot(),
        TypeOrmModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => {
            const database = config.get<string>('DB_NAME');
            if (database !== E2E_DB_NAME) {
              throw new Error(`Los e2e no pueden usar la base ${database}`);
            }
            return {
              type: 'postgres',
              host: config.get<string>('DB_HOST'),
              port: Number(config.get<string>('DB_PORT')),
              username: config.get<string>('DB_USERNAME'),
              password: String(config.get('DB_PASSWORD')),
              database,
              entities: [join(__dirname, '../src/**/*.entity.ts')],
              synchronize: true,
              dropSchema: true,
            };
          },
        }),
        PassportModule,
        SellersModule,
        SellersPublicModule,
      ],
      providers: [JwtStrategy],
    })
      .overrideProvider(CloudinaryService)
      .useValue({})
      .overrideProvider(ExchangeRateService)
      .useValue({
        getRate: (from: string, to: string) =>
          from === 'USD' && to === 'CRC'
            ? Promise.resolve({ rate: 500 })
            : Promise.reject(new ServiceUnavailableException()),
      })
      .compile();

    // Mismo bootstrap que main.ts.
    app = moduleRef.createNestApplication<INestApplication<App>>();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(app.get(Reflector)),
    );
    await app.init();
    dataSource = app.get(DataSource);

    const jwt = new JwtService({
      secret: app.get(ConfigService).get<string>('JWT_SECRET'),
    });
    cookieFor = (user) =>
      `access_token=${jwt.sign({ sub: user.id, email: user.email })}`;

    const users = repo(User);
    [seller, pending, inactive, buyer, admin] = await users.save([
      users.create({
        email: 'seller@e2e.test',
        username: 'karina',
        role: UserRole.SELLER,
        sellerRequestStatus: SellerRequestStatus.APPROVED,
        currency: 'CRC',
        location: 'Heredia',
        photoUrl: 'https://cdn/karina.png',
      }),
      users.create({
        email: 'pending@e2e.test',
        username: 'pendiente',
        sellerRequestStatus: SellerRequestStatus.PENDING,
        currency: 'CRC',
      }),
      users.create({
        email: 'inactive@e2e.test',
        username: 'inactivo',
        role: UserRole.SELLER,
        sellerRequestStatus: SellerRequestStatus.APPROVED,
        isActive: false,
      }),
      users.create({ email: 'buyer@e2e.test', username: 'comprador' }),
      users.create({
        email: 'admin@e2e.test',
        username: 'admin',
        role: UserRole.SUPERADMIN,
      }),
    ]);

    const newStore = async (
      user: User,
      values: Partial<Seller>,
    ): Promise<Seller> => {
      const paymentInfo = await repo(PaymentInfo).save({
        ownerFullName: user.username,
        name: 'BN',
        number: 'CR000000000000000000',
        type: PaymentType.BANK_ACCOUNT,
      });
      return repo(Seller).save({
        displayName: `Tienda ${user.username}`,
        description: 'Funkos originales',
        location: 'San José',
        userId: user.id,
        paymentId: paymentInfo.paymentInfoId,
        ...values,
      });
    };
    store = await newStore(seller, {
      isVerified: true,
      approvedAt: new Date('2026-09-01T12:00:00Z'),
      completedSalesCount: 3,
    });
    pendingStore = await newStore(pending, { isVerified: false });
    inactiveStore = await newStore(inactive, { isVerified: true });

    const category = await repo(Category).save({ name: 'Coleccionables' });
    const [publicCommunity, privateCommunity] = await repo(Community).save([
      {
        name: 'Funko',
        description: 'Funko',
        slug: 'funko',
        isPrivate: false,
        categoryId: category.categoryId,
      },
      {
        name: 'Secreta',
        description: 'Privada',
        slug: 'secreta',
        isPrivate: true,
        categoryId: category.categoryId,
      },
    ]);
    for (const name of ['funko', 'anime', 'privado']) {
      tags[name] = (await repo(Tag).save({ name })).tagId;
    }

    const seed = async (
      key: string,
      owner: Seller,
      values: Partial<Product>,
      tagNames: string[] = [],
    ) => {
      const product = await repo(Product).save({
        title: key,
        description: key,
        imageUrl: 'https://res.cloudinary.com/mynted/cover.png',
        status: ProductStatus.ACTIVE,
        type: ProductType.SALE,
        condition: ProductCondition.NEW,
        price: 10,
        currency: 'USD',
        sellerId: owner.sellerId,
        ...values,
      });
      await repo(ProductTag).save(
        tagNames.map((name) => ({ productId: product.id, tagId: tags[name] })),
      );
      products[key] = product.id;
    };
    // Públicos de la tienda: 'a' (comunidad pública) y 'b' (sin comunidad).
    await seed('a', store, { price: 100, communityId: publicCommunity.id }, [
      'funko',
      'anime',
    ]);
    await seed('b', store, { price: 50 }, ['funko']);
    // Nunca cuentan como activos públicos.
    await seed('privado', store, { communityId: privateCommunity.id }, [
      'privado',
    ]);
    await seed('vendido', store, { status: ProductStatus.SOLD }, ['funko']);
    await seed('borrador', store, { status: ProductStatus.DRAFT }, ['anime']);
    await seed('inactivo', store, { status: ProductStatus.INACTIVE });
    await seed('oculto', store, { isVisible: false }, ['anime']);
    await seed('del-pendiente', pendingStore, {}, ['funko']);

    await repo(Review).save([
      { productId: products.a, authorId: buyer.id, rating: 5, comment: null },
      {
        productId: products['del-pendiente'],
        authorId: buyer.id,
        rating: 1,
        comment: null,
      },
    ]);

    // Tiempo de respuesta. Fechas relativas a hace 2 días; las conversaciones
    // usan productos distintos (único por comprador, vendedor y producto).
    await seed('borrado', store, {});
    await repo(Product).softDelete(products.borrado);
    const DAY = 24 * 60;
    const conversation = async (
      productKey: string,
      owner: User,
      messages: [User, number][],
    ) => {
      const { id } = await repo(Conversation).save({
        buyerId: buyer.id,
        sellerId: owner.id,
        productId: products[productKey],
      });
      for (const [sender, minutesAgo] of messages) {
        await dataSource.query(
          `INSERT INTO message (conversation_id, sender_id, type, content, created_at)
           VALUES ($1, $2, 'text', 'hola', now() - make_interval(mins => $3))`,
          [id, sender.id, minutesAgo],
        );
      }
    };
    const T = 2 * DAY;
    // Responde a los 10 minutos.
    await conversation('a', seller, [
      [buyer, T],
      [seller, T - 10],
      [seller, T - 15],
    ]);
    // El vendedor escribe primero (se ignora); responde 30 minutos después
    // del primer mensaje del comprador.
    await conversation('b', seller, [
      [seller, T + 5],
      [buyer, T],
      [buyer, T - 1],
      [seller, T - 30],
    ]);
    // Sin respuesta: no cuenta.
    await conversation('privado', seller, [[buyer, T]]);
    // Producto borrado: cuenta (responde a los 20 minutos).
    await conversation('borrado', seller, [
      [buyer, T],
      [seller, T - 20],
    ]);
    // Fuera de la ventana de 90 días: no cuenta.
    await conversation('vendido', seller, [
      [buyer, 100 * DAY],
      [seller, 100 * DAY - 1],
    ]);

    // Tienda con solo 2 conversaciones respondidas: responseTime null.
    const [fewUser] = await repo(User).save([
      {
        email: 'few@e2e.test',
        username: 'pocos',
        role: UserRole.SELLER,
        sellerRequestStatus: SellerRequestStatus.APPROVED,
      },
    ]);
    fewStore = await newStore(fewUser, {
      isVerified: true,
      displayName: 'Juguetería Ñandú',
      description: 'Figuras de anime japonés',
      location: '',
    });
    for (const key of ['pocos-1', 'pocos-2']) {
      await seed(key, fewStore, {});
      await conversation(key, fewUser, [
        [buyer, T],
        [fewUser, T - 5],
      ]);
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('GET /sellers/:sellerId', () => {
    it('devuelve la tienda sin sesión, sin payment_info ni correo', async () => {
      const res = await http().get(`/sellers/${store.sellerId}`).expect(200);

      expect(res.body).toEqual({
        sellerId: store.sellerId,
        userId: seller.id,
        displayName: 'Tienda karina',
        description: 'Funkos originales',
        location: 'San José',
        photoUrl: 'https://cdn/karina.png',
        bannerUrl: null,
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
        isVerified: true,
        isPro: false,
        frame: { code: 'frame_default', assetUrl: null },
        ratingAverage: 5,
        reviewsCount: 1,
        completedSalesCount: 3,
        activeProductsCount: 2,
        sellerSince: '2026-09-01T12:00:00.000Z',
        // Mediana de 10, 30 y 20 minutos.
        responseTime: { medianMinutes: 20, sampleSize: 3 },
      });
    });

    it('404 para pendientes, desactivados e inexistentes; 400 si no es entero', async () => {
      await http().get(`/sellers/${pendingStore.sellerId}`).expect(404);
      await http().get(`/sellers/${inactiveStore.sellerId}`).expect(404);
      await http().get('/sellers/999999').expect(404);
      await http().get('/sellers/99999999999').expect(404);
      await http().get('/sellers/abc').expect(400);
    });
  });

  describe('GET /sellers/:sellerId/products', () => {
    const titlesOf = (body: unknown) =>
      (body as { data: { title: string }[] }).data.map((p) => p.title);

    it('por defecto: activos, visibles y sin comunidades privadas', async () => {
      const res = await http()
        .get(`/sellers/${store.sellerId}/products`)
        .expect(200);

      expect(titlesOf(res.body)).toEqual(['b', 'a']);
      expect(res.body).toMatchObject({
        pagination: { page: 1, limit: 10, total: 2, totalPages: 1 },
      });
    });

    it('status=sold lista los vendidos; draft e inactive dan 400', async () => {
      const sold = await http()
        .get(`/sellers/${store.sellerId}/products?status=sold`)
        .expect(200);
      expect(titlesOf(sold.body)).toEqual(['vendido']);

      await http()
        .get(`/sellers/${store.sellerId}/products?status=draft`)
        .expect(400);
      await http()
        .get(`/sellers/${store.sellerId}/products?status=inactive`)
        .expect(400);
    });

    it('sort recent y newest son sinónimos; price_asc y price_desc ordenan por precio', async () => {
      const get = async (sort: string) =>
        titlesOf(
          (
            await http()
              .get(`/sellers/${store.sellerId}/products?sort=${sort}`)
              .expect(200)
          ).body,
        );

      await expect(get('recent')).resolves.toEqual(['b', 'a']);
      await expect(get('newest')).resolves.toEqual(['b', 'a']);
      await expect(get('price_asc')).resolves.toEqual(['b', 'a']);
      await expect(get('price_desc')).resolves.toEqual(['a', 'b']);
      await http()
        .get(`/sellers/${store.sellerId}/products?sort=cheapest`)
        .expect(400);
    });

    it('filtra por tag y trae los campos display* según X-Display-Currency', async () => {
      const res = await http()
        .get(`/sellers/${store.sellerId}/products?tag=${tags.anime}`)
        .set('X-Display-Currency', 'CRC')
        .expect(200);

      expect(titlesOf(res.body)).toEqual(['a']);
      expect((res.body as { data: unknown[] }).data[0]).toMatchObject({
        price: 100,
        currency: 'USD',
        displayPrice: 50000,
        displayFinalPrice: 50000,
        displayCurrency: 'CRC',
        isConverted: true,
        isSaved: false,
      });
    });

    it('404 si la tienda no es pública', async () => {
      await http()
        .get(`/sellers/${inactiveStore.sellerId}/products`)
        .expect(404);
    });
  });

  describe('GET /sellers/:sellerId/tags', () => {
    it('cuenta solo productos activos, visibles y de comunidades públicas', async () => {
      const res = await http()
        .get(`/sellers/${store.sellerId}/tags`)
        .expect(200);

      expect(res.body).toEqual([
        { tagId: tags.funko, name: 'funko', count: 2 },
        { tagId: tags.anime, name: 'anime', count: 1 },
      ]);
    });

    it('404 si la tienda no es pública', async () => {
      await http().get(`/sellers/${pendingStore.sellerId}/tags`).expect(404);
    });
  });

  // Antes de aprobar al pendiente (el último describe lo aprueba).
  describe('búsqueda de tiendas (type=stores)', () => {
    const search = (q: string) =>
      app.get(SellersPublicService).searchStores(q, 1, 10);
    const namesOf = async (q: string) =>
      (await search(q)).data.map((item) => item.displayName);

    it('no distingue mayúsculas ni tildes, en el nombre y la descripción', async () => {
      await expect(namesOf('jugueteria')).resolves.toEqual([
        'Juguetería Ñandú',
      ]);
      await expect(namesOf('ÑANDU')).resolves.toEqual(['Juguetería Ñandú']);
      await expect(namesOf('nandú')).resolves.toEqual(['Juguetería Ñandú']);
      await expect(namesOf('JAPONES')).resolves.toEqual(['Juguetería Ñandú']);
    });

    it('solo vendedores aprobados con cuenta activa', async () => {
      await expect(namesOf('pendiente')).resolves.toEqual([]);
      await expect(namesOf('inactivo')).resolves.toEqual([]);
      await expect(namesOf('tienda')).resolves.toEqual(['Tienda karina']);
    });

    it('trae rating, productos activos y la location con respaldo al usuario', async () => {
      const result = await search('karina');

      expect(result).toEqual({
        data: [
          {
            sellerId: store.sellerId,
            userId: seller.id,
            displayName: 'Tienda karina',
            photoUrl: 'https://cdn/karina.png',
            location: 'San José',
            isVerified: true,
            isPro: false,
            frame: { code: 'frame_default', assetUrl: null },
            ratingAverage: 5,
            reviewsCount: 1,
            activeProductsCount: 2,
          },
        ],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      });

      const [few] = (await search('ñandú')).data;
      // Sin location en la tienda ni en el usuario.
      expect(few).toMatchObject({ location: null, activeProductsCount: 2 });
    });

    it('escapa los comodines de LIKE', async () => {
      await expect(namesOf('%')).resolves.toEqual([]);
    });
  });

  describe('convivencia con las rutas de comisión', () => {
    it('sellers/me/commission y /estimate siguen llegando a su controller', async () => {
      await http().get('/sellers/me/commission').expect(401);
      await http().get('/sellers/me/commission/estimate').expect(401);

      await http()
        .get('/sellers/me/commission')
        .set('Cookie', cookieFor(seller))
        .expect(200);
      await http()
        .get('/sellers/me/commission/estimate?amount=10000')
        .set('Cookie', cookieFor(seller))
        .expect(200);
    });
  });

  describe('solo los vendedores aprobados cuentan como vendedores', () => {
    it('el perfil público de un pendiente no trae objeto seller', async () => {
      const res = await http()
        .get(`/users/${pending.id}`)
        .set('Cookie', cookieFor(buyer))
        .expect(200);

      expect(res.body).not.toHaveProperty('seller');
    });

    it('el perfil público de un aprobado trae su rating', async () => {
      const res = await http()
        .get(`/users/${seller.id}`)
        .set('Cookie', cookieFor(buyer))
        .expect(200);

      expect(res.body).toMatchObject({
        seller: {
          sellerId: store.sellerId,
          ratingAverage: 5,
          reviewsCount: 1,
          responseTime: { medianMinutes: 20, sampleSize: 3 },
        },
      });
    });

    it('al aprobar la solicitud se registra approved_at y la tienda aparece', async () => {
      await http()
        .patch(`/users/${pending.id}/seller-status`)
        .set('Cookie', cookieFor(admin))
        .send({ status: SellerRequestStatus.APPROVED })
        .expect(200);

      const res = await http()
        .get(`/sellers/${pendingStore.sellerId}`)
        .expect(200);
      expect(res.body).toMatchObject({
        sellerId: pendingStore.sellerId,
        isVerified: true,
        // La reseña de su producto ahora sí cuenta.
        ratingAverage: 1,
        reviewsCount: 1,
      });
      expect(
        Date.now() -
          new Date((res.body as { sellerSince: string }).sellerSince).getTime(),
      ).toBeLessThan(60_000);
    });
  });

  describe('tiempo de respuesta', () => {
    it('null si la tienda tiene menos de 3 conversaciones respondidas', async () => {
      const res = await http().get(`/sellers/${fewStore.sellerId}`).expect(200);

      expect(res.body).toMatchObject({ responseTime: null });
    });

    it('aparece en el perfil por username', async () => {
      const res = await http()
        .get(`/users/by-username/${seller.username}`)
        .set('Cookie', cookieFor(buyer))
        .expect(200);

      expect(res.body).toMatchObject({
        seller: { responseTime: { medianMinutes: 20, sampleSize: 3 } },
      });
    });

    it('GET /users/me agrega seller al vendedor aprobado sin cambiar el resto', async () => {
      const res = await http()
        .get('/users/me')
        .set('Cookie', cookieFor(seller))
        .expect(200);

      expect(res.body).toMatchObject({
        id: seller.id,
        email: 'seller@e2e.test',
        currency: 'CRC',
        seller: {
          sellerId: store.sellerId,
          displayName: 'Tienda karina',
          isVerified: true,
          ratingAverage: 5,
          reviewsCount: 1,
          responseTime: { medianMinutes: 20, sampleSize: 3 },
        },
      });
      // Los campos @Exclude siguen ocultos.
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('resetPasswordTokenHash');
    });

    it('GET /users/me de quien no es vendedor no trae seller', async () => {
      const res = await http()
        .get('/users/me')
        .set('Cookie', cookieFor(buyer))
        .expect(200);

      expect(res.body).toMatchObject({ id: buyer.id });
      expect(res.body).not.toHaveProperty('seller');
    });
  });
});
