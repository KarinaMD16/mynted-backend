import {
  INestApplication,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import cookieParser from 'cookie-parser';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { Category } from '../src/community/entities/category.entity';
import { CommunityProfile } from '../src/community/entities/community-profile.entity';
import { Community } from '../src/community/entities/community.entity';
import { Favorite } from '../src/community/entities/favorite.entity';
import { Tag } from '../src/community/entities/tag.entity';
import { ExchangeRateService } from '../src/payments/exchange-rate/exchange-rate.service';
import { ResolveDisplayCurrencyPipe } from '../src/pricing/display-currency.decorator';
import { PriceDisplayService } from '../src/pricing/price-display.service';
import { GetProductsQueryDto } from '../src/products/dto/get-products-query.dto';
import { GetShopQueryDto } from '../src/products/dto/get-shop-query.dto';
import { ProductSort } from '../src/products/dto/product-price-query.dto';
import { ProductTag } from '../src/products/entities/product-tag.entity';
import { ProductView } from '../src/products/entities/product-view.entity';
import {
  Product,
  ProductCondition,
  ProductStatus,
  ProductType,
} from '../src/products/entities/product.entity';
import { ProductsController } from '../src/products/products.controller';
import { ProductsService } from '../src/products/products.service';
import {
  PaymentInfo,
  PaymentType,
} from '../src/sellers/entities/payment-info.entity';
import { Seller } from '../src/sellers/entities/seller.entity';
import { UserTag } from '../src/user-tags/entities/user-tag.entity';
import { User } from '../src/users/entities/user.entity';
import { UsersService } from '../src/users/users.service';
import { E2E_DB_NAME } from './e2e-database';

/**
 * Filtros y orden por precio con monedas mezcladas, contra Postgres real: el
 * SQL de normalización a USD es lo que se prueba. Las tasas son fijas
 * (unidades por 1 USD); CLP no tiene tasa. El bloque HTTP usa el
 * ProductsController real para probar la resolución de X-Display-Currency.
 */
jest.setTimeout(60_000);

const USD_RATES: Record<string, number> = { CRC: 500, EUR: 0.8, MXN: 20 };

describe('Precios en la moneda de visualización (e2e)', () => {
  let app: INestApplication<App>;
  let service: ProductsService;
  let cookieFor: (user: User) => string;
  let viewerWithDisplay: User;
  let viewerWithCurrency: User;
  const ids: Record<string, number> = {};
  let otherTagId: number;
  let categoryId: number;

  const query = <T extends object>(Dto: new () => T, values: Partial<T>): T =>
    Object.assign(new Dto(), values);
  const titles = (items: { id: number }[]) =>
    items.map(
      (item) => Object.entries(ids).find(([, id]) => id === item.id)![0],
    );

  beforeAll(async () => {
    const getRate = (from: string, to: string) => {
      const rate = USD_RATES[to];
      return from === 'USD' && rate !== undefined
        ? Promise.resolve({ rate })
        : Promise.reject(new ServiceUnavailableException());
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
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
      ],
      controllers: [ProductsController],
      providers: [
        JwtStrategy,
        ResolveDisplayCurrencyPipe,
        // Solo lo pide SellerGuard (rutas que aquí no se usan).
        { provide: UsersService, useValue: {} },
        {
          provide: PriceDisplayService,
          inject: [DataSource],
          useFactory: (dataSource: DataSource) =>
            new PriceDisplayService(
              { getRate } as unknown as ExchangeRateService,
              dataSource.getRepository(User),
            ),
        },
        {
          provide: ProductsService,
          inject: [DataSource, PriceDisplayService],
          useFactory: (
            dataSource: DataSource,
            priceDisplay: PriceDisplayService,
          ) =>
            new ProductsService(
              dataSource.getRepository(Product),
              dataSource.getRepository(Seller),
              dataSource.getRepository(Community),
              dataSource.getRepository(CommunityProfile),
              dataSource.getRepository(Tag),
              dataSource.getRepository(UserTag),
              dataSource.getRepository(Favorite),
              dataSource.getRepository(ProductView),
              { getSellerRatings: () => Promise.resolve(new Map()) } as never,
              {
                getProductRating: () =>
                  Promise.resolve({ ratingAverage: null, reviewsCount: 0 }),
                getReviewStatus: () =>
                  Promise.resolve({
                    canReview: false,
                    hasReviewed: false,
                    reviewId: null,
                  }),
              } as never,
              {} as never,
              dataSource,
              priceDisplay,
              {
                proUserIds: () => Promise.resolve(new Set<string>()),
                isPro: () => Promise.resolve(false),
              } as never,
            ),
        },
      ],
    }).compile();

    // Mismo bootstrap que main.ts.
    app = moduleRef.createNestApplication<INestApplication<App>>();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    service = app.get(ProductsService);

    const dataSource = app.get(DataSource);
    const repo = <T extends object>(entity: new () => T) =>
      dataSource.getRepository(entity);

    [viewerWithDisplay, viewerWithCurrency] = await repo(User).save([
      {
        email: 'display@e2e.test',
        username: 've_eur',
        displayCurrency: 'EUR',
        currency: 'MXN',
      },
      { email: 'currency@e2e.test', username: 've_mxn', currency: 'MXN' },
    ]);
    const jwt = new JwtService({
      secret: app.get(ConfigService).get<string>('JWT_SECRET'),
    });
    cookieFor = (user) =>
      `access_token=${jwt.sign({ sub: user.id, email: user.email })}`;

    const user = await repo(User).save({
      email: 'seller@e2e.test',
      username: 'vendedor',
    });
    const paymentInfo = await repo(PaymentInfo).save({
      ownerFullName: 'Vendedor',
      name: 'BN',
      number: 'CR000000000000000000',
      type: PaymentType.BANK_ACCOUNT,
    });
    const seller = await repo(Seller).save({
      displayName: 'Tienda',
      description: 'Tienda',
      location: 'San José',
      userId: user.id,
      paymentId: paymentInfo.paymentInfoId,
    });
    const category = await repo(Category).save({ name: 'Coleccionables' });
    categoryId = category.categoryId;
    const community = await repo(Community).save({
      name: 'Funko',
      description: 'Funko',
      slug: 'funko',
      isPrivate: false,
      categoryId,
    });
    const [mainTag, otherTag] = await repo(Tag).save([
      { name: 'figuras' },
      { name: 'otros' },
    ]);
    otherTagId = otherTag.tagId;

    // Precio final en USD: A 30 · B 20 · C 12.5 (20 EUR -50 %) · D 35 · E sin tasa.
    const seed = async (
      key: string,
      values: Partial<Product>,
      tagIds = [mainTag.tagId],
    ) => {
      const product = await repo(Product).save({
        title: key,
        description: key,
        imageUrl: 'https://res.cloudinary.com/mynted/cover.png',
        status: ProductStatus.ACTIVE,
        type: ProductType.SALE,
        condition: ProductCondition.NEW,
        sellerId: seller.sellerId,
        ...values,
      });
      await repo(ProductTag).save(
        tagIds.map((tagId) => ({ productId: product.id, tagId })),
      );
      ids[key] = product.id;
    };
    await seed('A', { price: 30, currency: 'USD', communityId: community.id }, [
      mainTag.tagId,
      otherTag.tagId,
    ]);
    await seed('B', { price: 10000, currency: 'CRC' });
    await seed('C', { price: 20, discountPercent: 50, currency: 'EUR' });
    await seed('D', {
      price: 700,
      currency: 'MXN',
      shipsTo: ['MX'],
      condition: ProductCondition.LIKE_NEW,
    });
    await seed('E', { price: 100, currency: 'CLP' });
    // Fuera de cualquier listado público.
    await seed('inactivo', {
      price: 1,
      currency: 'USD',
      status: ProductStatus.INACTIVE,
    });
    await seed('oculto', { price: 25, currency: 'USD', isVisible: false });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('GET /products', () => {
    it('price_asc ordena por el precio final normalizado a USD; sin tasa al final', async () => {
      const result = await service.findAll(
        query(GetProductsQueryDto, { sort: ProductSort.PRICE_ASC }),
        undefined,
        'USD',
      );

      expect(titles(result.data)).toEqual(['C', 'B', 'A', 'D', 'E']);
      expect(result.pagination.total).toBe(5);
    });

    it('price_desc invierte el orden y mantiene al final los que no tienen tasa', async () => {
      const result = await service.findAll(
        query(GetProductsQueryDto, { sort: ProductSort.PRICE_DESC }),
        undefined,
        'USD',
      );

      expect(titles(result.data)).toEqual(['D', 'A', 'B', 'C', 'E']);
    });

    it('el rango se interpreta en la moneda de visualización (límites incluidos)', async () => {
      // 10000–15000 CRC = 20–30 USD: entran B (10000 CRC) y A (15000 CRC).
      const result = await service.findAll(
        query(GetProductsQueryDto, {
          sort: ProductSort.PRICE_ASC,
          priceMin: 10000,
          priceMax: 15000,
        }),
        undefined,
        'CRC',
      );

      expect(titles(result.data)).toEqual(['B', 'A']);
      expect(result.data).toEqual([
        expect.objectContaining({
          price: 10000,
          currency: 'CRC',
          displayFinalPrice: 10000,
          displayCurrency: 'CRC',
          isConverted: false,
        }),
        expect.objectContaining({
          price: 30,
          currency: 'USD',
          displayPrice: 15000,
          displayFinalPrice: 15000,
          displayCurrency: 'CRC',
          isConverted: true,
        }),
      ]);
    });

    it('acepta decimales y compara contra el precio final con descuento', async () => {
      const result = await service.findAll(
        query(GetProductsQueryDto, { priceMin: 12.5, priceMax: 12.5 }),
        undefined,
        'USD',
      );

      expect(titles(result.data)).toEqual(['C']);
      expect(result.data[0]).toMatchObject({
        finalPrice: 10,
        displayFinalPrice: 12.5,
      });
    });

    it('si la moneda de visualización no tiene tasa solo filtra sus propios productos', async () => {
      const result = await service.findAll(
        query(GetProductsQueryDto, { priceMax: 200 }),
        undefined,
        'CLP',
      );

      expect(titles(result.data)).toEqual(['E']);
      expect(result.data[0]).toMatchObject({
        displayPrice: 100,
        isConverted: false,
      });
    });

    it('newest (por defecto) ordena por fecha y muestra null donde no hay tasa', async () => {
      const result = await service.findAll(
        query(GetProductsQueryDto, {}),
        undefined,
        'USD',
      );

      expect(titles(result.data)).toEqual(['E', 'D', 'C', 'B', 'A']);
      expect(result.data[0]).toMatchObject({
        displayPrice: null,
        displayFinalPrice: null,
        isConverted: false,
      });
    });

    it('pagina sobre el orden por precio', async () => {
      const result = await service.findAll(
        query(GetProductsQueryDto, {
          sort: ProductSort.PRICE_ASC,
          page: 2,
          limit: 2,
        }),
        undefined,
        'USD',
      );

      expect(titles(result.data)).toEqual(['A', 'D']);
      expect(result.pagination).toEqual({
        page: 2,
        limit: 2,
        total: 5,
        totalPages: 3,
      });
    });

    it('mantiene los filtros existentes (tag, categoría, comunidad, país, currency, condition)', async () => {
      const run = async (values: Partial<GetProductsQueryDto>) =>
        titles(
          (
            await service.findAll(
              query(GetProductsQueryDto, values),
              undefined,
              'USD',
            )
          ).data,
        );

      await expect(run({ tag: otherTagId })).resolves.toEqual(['A']);
      await expect(run({ category: categoryId })).resolves.toEqual(['A']);
      await expect(run({ communityId: 999 })).resolves.toEqual([]);
      await expect(run({ shipTo: 'MX' })).resolves.toEqual(['D']);
      await expect(run({ currency: 'EUR' })).resolves.toEqual(['C']);
      await expect(
        run({ condition: ProductCondition.LIKE_NEW }),
      ).resolves.toEqual(['D']);
    });
  });

  describe('GET /products/shop', () => {
    it('ordena y filtra los productos de cada sección por precio', async () => {
      const result = await service.findShop(
        undefined,
        query(GetShopQueryDto, {
          sort: ProductSort.PRICE_DESC,
          priceMax: 30,
          productsLimit: 10,
        }),
        'USD',
      );

      const [section] = result.sections;
      expect(titles(section.products)).toEqual(['A', 'B', 'C']);
      expect(section.products[1]).toMatchObject({
        price: 10000,
        currency: 'CRC',
        displayPrice: 20,
        displayCurrency: 'USD',
        isConverted: true,
        isSaved: false,
      });
    });
  });

  describe('HTTP: resolución de la moneda de visualización', () => {
    const http = () => request(app.getHttpServer());
    const listOf = (body: unknown) => (body as { data: { id: number }[] }).data;
    const productA = (body: unknown) =>
      listOf(body).find((item) => item.id === ids.A);

    it('visitante sin header: CRC por defecto', async () => {
      const res = await http().get('/products').expect(200);
      expect(productA(res.body)).toMatchObject({
        price: 30,
        currency: 'USD',
        displayPrice: 15000,
        displayCurrency: 'CRC',
        isConverted: true,
      });
    });

    it('header válido (en minúsculas) manda sobre las preferencias del usuario', async () => {
      const res = await http()
        .get('/products')
        .set('X-Display-Currency', 'eur')
        .set('Cookie', cookieFor(viewerWithCurrency))
        .expect(200);
      expect(productA(res.body)).toMatchObject({
        displayPrice: 24,
        displayCurrency: 'EUR',
      });
    });

    it('header inválido: se ignora sin 400 y sigue la cadena', async () => {
      const res = await http()
        .get('/products')
        .set('X-Display-Currency', 'XYZ')
        .expect(200);
      expect(productA(res.body)).toMatchObject({ displayCurrency: 'CRC' });
    });

    it('usuario con displayCurrency: la usa en lugar de su currency', async () => {
      const res = await http()
        .get('/products')
        .set('Cookie', cookieFor(viewerWithDisplay))
        .expect(200);
      expect(productA(res.body)).toMatchObject({ displayCurrency: 'EUR' });
    });

    it('usuario solo con currency: la usa para mostrar', async () => {
      const res = await http()
        .get(`/products/${ids.A}`)
        .set('Cookie', cookieFor(viewerWithCurrency))
        .expect(200);
      expect(res.body).toMatchObject({
        price: 30,
        currency: 'USD',
        displayPrice: 600,
        displayCurrency: 'MXN',
        isConverted: true,
      });
    });

    it('rango con decimales y sort por query string', async () => {
      const res = await http()
        .get('/products?sort=price_desc&priceMax=30.5')
        .set('X-Display-Currency', 'USD')
        .expect(200);
      expect(titles(listOf(res.body))).toEqual(['A', 'B', 'C']);

      await http().get('/products?sort=cheapest').expect(400);
      await http().get('/products?priceMin=1.234').expect(400);
    });
  });
});
