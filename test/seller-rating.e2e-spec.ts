import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'node:path';
import { DataSource, Repository } from 'typeorm';
import { BadgesService } from '../src/badges/badges.service';
import { CloudinaryService } from '../src/cloudinary/cloudinary.service';
import {
  Product,
  ProductCondition,
  ProductStatus,
  ProductType,
} from '../src/products/entities/product.entity';
import { Review } from '../src/products/entities/review.entity';
import { ReviewsService } from '../src/products/reviews.service';
import { ReputationService } from '../src/reputation/reputation.service';
import { ProStatusService } from '../src/pro-status/pro-status.service';
import { ResponseTimeService } from '../src/response-time/response-time.service';
import {
  PaymentInfo,
  PaymentType,
} from '../src/sellers/entities/payment-info.entity';
import { Seller } from '../src/sellers/entities/seller.entity';
import { User } from '../src/users/entities/user.entity';
import { UserOAuthAccount } from '../src/users/entities/user-oauth-account.entity';
import { UsersService } from '../src/users/users.service';
import { E2E_DB_NAME } from './e2e-database';

/**
 * Rating del vendedor contra Postgres real: las reseñas de productos
 * borrados (soft delete) cuentan; las de vendedores no aprobados no, y las
 * reseñas borradas por su autor tampoco. El rating de un producto individual
 * no cambia.
 */
jest.setTimeout(90_000);

describe('Rating del vendedor (e2e)', () => {
  let dataSource: DataSource;
  let usersService: UsersService;
  let reputationService: ReputationService;
  let reviewsService: ReviewsService;

  let seller: Seller;
  let pendingSeller: Seller;
  let emptySeller: Seller;
  const reviewers: User[] = [];
  const products: Record<string, number> = {};

  const repo = <T extends object>(entity: new () => T): Repository<T> =>
    dataSource.getRepository(entity);

  const ratingOf = async (sellerId: number) =>
    (await usersService.getSellerRatings([sellerId])).get(sellerId);

  beforeAll(async () => {
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
      ],
    }).compile();
    dataSource = moduleRef.get(DataSource);

    usersService = new UsersService(
      repo(User),
      repo(UserOAuthAccount),
      {} as CloudinaryService,
      repo(Seller),
      {} as ResponseTimeService,
      {} as ProStatusService,
      {} as never,
    );
    reputationService = new ReputationService(
      repo(User),
      repo(Seller),
      usersService,
      { findUserBadges: () => Promise.resolve([]) } as unknown as BadgesService,
      { isPro: () => Promise.resolve(false) } as unknown as ProStatusService,
    );
    reviewsService = new ReviewsService(
      repo(Review),
      repo(Product),
      {} as never,
      {} as never,
    );

    const users = repo(User);
    const [sellerUser, pendingUser, emptyUser] = await users.save(
      ['vendedor', 'pendiente', 'sinresenas'].map((name) =>
        users.create({ email: `${name}@e2e.test`, username: name }),
      ),
    );
    for (const name of ['r1', 'r2', 'r3']) {
      reviewers.push(
        await users.save(
          users.create({ email: `${name}@e2e.test`, username: name }),
        ),
      );
    }

    const newStore = async (user: User, isVerified: boolean) => {
      const paymentInfo = await repo(PaymentInfo).save({
        ownerFullName: user.username,
        name: 'BN',
        number: 'CR000000000000000000',
        type: PaymentType.BANK_ACCOUNT,
      });
      return repo(Seller).save({
        displayName: `Tienda ${user.username}`,
        description: 'Funkos',
        location: 'San José',
        userId: user.id,
        paymentId: paymentInfo.paymentInfoId,
        isVerified,
      });
    };
    seller = await newStore(sellerUser, true);
    pendingSeller = await newStore(pendingUser, false);
    emptySeller = await newStore(emptyUser, true);

    const seed = async (key: string, owner: Seller) => {
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
      });
      products[key] = product.id;
    };
    await seed('activo', seller);
    await seed('a-borrar', seller);
    await seed('del-pendiente', pendingSeller);
    await seed('sin-resenas', emptySeller);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  // Reseñas del vendedor: 'activo' 5 (r1) y 4 (r2); 'a-borrar' 4 (r1). Promedio
  // exacto 13/3 = 4.333… → 4.3. La reseña del vendedor pendiente no cuenta.
  it('con productos activos y otro por borrar, todas las reseñas cuentan', async () => {
    await repo(Review).save([
      { productId: products.activo, authorId: reviewers[0].id, rating: 5 },
      { productId: products.activo, authorId: reviewers[1].id, rating: 4 },
      { productId: products['a-borrar'], authorId: reviewers[0].id, rating: 4 },
      {
        productId: products['del-pendiente'],
        authorId: reviewers[0].id,
        rating: 1,
      },
    ]);

    await expect(ratingOf(seller.sellerId)).resolves.toEqual({
      ratingAverage: 4.3,
      reviewsCount: 3,
    });
  });

  it('borrar un producto (soft delete) no cambia el rating del vendedor', async () => {
    const before = await ratingOf(seller.sellerId);

    await repo(Product).softDelete(products['a-borrar']);
    const deleted = await repo(Product).findOne({
      where: { id: products['a-borrar'] },
      withDeleted: true,
    });
    expect(deleted?.deletedAt).not.toBeNull();

    await expect(ratingOf(seller.sellerId)).resolves.toEqual(before);
    await expect(ratingOf(seller.sellerId)).resolves.toEqual({
      ratingAverage: 4.3,
      reviewsCount: 3,
    });
  });

  it('la reputación (promedio, total y distribución) incluye el producto borrado', async () => {
    const reputation = await reputationService.getUserReputation(seller.userId);

    expect(reputation).toMatchObject({
      isSeller: true,
      ratingAverage: 4.3,
      reviewsCount: 3,
      ratingDistribution: { '1': 0, '2': 0, '3': 0, '4': 2, '5': 1 },
    });
    // El total de la distribución coincide con el conteo del rating.
    const {
      '1': one,
      '2': two,
      '3': three,
      '4': four,
      '5': five,
    } = reputation.ratingDistribution;
    const total = one + two + three + four + five;
    expect(total).toBe(reputation.reviewsCount);
  });

  it('el rating de un producto individual no cambia: usa solo sus reseñas', async () => {
    await expect(
      reviewsService.getProductRating(products.activo),
    ).resolves.toEqual({ ratingAverage: 4.5, reviewsCount: 2 });
    await expect(
      reviewsService.getProductRating(products['a-borrar']),
    ).resolves.toEqual({ ratingAverage: 4, reviewsCount: 1 });
  });

  it('un vendedor no aprobado sigue sin rating, aunque tenga reseñas', async () => {
    const ratings = await usersService.getSellerRatings([
      pendingSeller.sellerId,
    ]);

    expect(ratings.has(pendingSeller.sellerId)).toBe(false);
    expect(
      (await usersService.getSellerRatingDistribution(pendingSeller.sellerId))
        .size,
    ).toBe(0);
  });

  it('un vendedor sin reseñas no aparece con rating', async () => {
    const ratings = await usersService.getSellerRatings([emptySeller.sellerId]);

    expect(ratings.has(emptySeller.sellerId)).toBe(false);
  });

  it('una reseña borrada por su autor deja de contar, también en un producto borrado', async () => {
    await repo(Review).delete({
      productId: products['a-borrar'],
      authorId: reviewers[0].id,
    });

    // Quedan 5 y 4 del producto activo: 4.5 con 2 reseñas.
    await expect(ratingOf(seller.sellerId)).resolves.toEqual({
      ratingAverage: 4.5,
      reviewsCount: 2,
    });
  });

  it('si el vendedor deja de estar aprobado, su rating desaparece', async () => {
    await repo(Seller).update(seller.sellerId, { isVerified: false });

    const ratings = await usersService.getSellerRatings([seller.sellerId]);
    expect(ratings.has(seller.sellerId)).toBe(false);

    await repo(Seller).update(seller.sellerId, { isVerified: true });
  });
});
