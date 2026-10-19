import {
  ClassSerializerInterceptor,
  INestApplication,
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
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { JwtStrategy } from '../../src/auth/strategies/jwt.strategy';
import { CloudinaryService } from '../../src/cloudinary/cloudinary.service';
import { ConversationsModule } from '../../src/conversations/conversations.module';
import {
  Product,
  ProductCondition,
  ProductStatus,
  ProductType,
} from '../../src/products/entities/product.entity';
import {
  PaymentInfo,
  PaymentType,
} from '../../src/sellers/entities/payment-info.entity';
import { Seller } from '../../src/sellers/entities/seller.entity';
import { User } from '../../src/users/entities/user.entity';
import { E2E_DB_NAME } from '../e2e-database';

export const CLOUDINARY_URL =
  'https://res.cloudinary.com/mynted/image/upload/v1/chat/e2e.png';

export interface ChatTestApp {
  app: INestApplication<App>;
  dataSource: DataSource;
  cloudinary: { uploadImage: jest.Mock };
  buyer: User;
  seller: User;
  outsider: User;
  product: Product;
  // Cookie "access_token=<jwt>" del usuario, firmada con JWT_SECRET.
  cookieFor(user: User): string;
}

/**
 * App mínima para los e2e del chat: ConversationsModule + JWT por cookie +
 * EventEmitter (para el gateway), con el mismo bootstrap que main.ts. Recrea
 * el esquema de la base e2e y siembra comprador, vendedor (tienda verificada),
 * un tercero y un producto activo. Cloudinary es un fake.
 */
export async function createChatTestApp(): Promise<ChatTestApp> {
  const cloudinary = { uploadImage: jest.fn() };

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      EventEmitterModule.forRoot(),
      TypeOrmModule.forRootAsync({
        inject: [ConfigService],
        useFactory: (config: ConfigService) => {
          // Defensa extra: dropSchema solo sobre la base e2e (e2e-env.ts).
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
            entities: [join(__dirname, '../../src/**/*.entity.ts')],
            synchronize: true,
            dropSchema: true,
          };
        },
      }),
      PassportModule,
      ConversationsModule,
    ],
    providers: [JwtStrategy],
  })
    .overrideProvider(CloudinaryService)
    .useValue(cloudinary)
    .compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  await app.init();

  const dataSource = app.get(DataSource);
  const users = dataSource.getRepository(User);
  const [buyer, seller, outsider] = await users.save([
    users.create({ email: 'buyer@e2e.test', username: 'comprador' }),
    users.create({ email: 'seller@e2e.test', username: 'karina' }),
    users.create({ email: 'outsider@e2e.test', username: 'curioso' }),
  ]);

  const paymentInfo = await dataSource.getRepository(PaymentInfo).save({
    ownerFullName: 'Karina Mora',
    name: 'BN',
    number: 'CR000000000000000000',
    type: PaymentType.BANK_ACCOUNT,
  });
  const store = await dataSource.getRepository(Seller).save({
    displayName: 'Funko Corner CR',
    description: 'Funkos',
    location: 'San José',
    isVerified: true,
    userId: seller.id,
    paymentId: paymentInfo.paymentInfoId,
  });
  const product = await dataSource.getRepository(Product).save({
    title: 'Funko Pop Goku SSJ',
    description: 'Nuevo en caja',
    price: 25000,
    discountPercent: 10,
    currency: 'CRC',
    imageUrl: 'https://res.cloudinary.com/mynted/cover.png',
    status: ProductStatus.ACTIVE,
    type: ProductType.SALE,
    condition: ProductCondition.NEW,
    sellerId: store.sellerId,
  });

  const jwt = new JwtService({
    secret: app.get(ConfigService).get<string>('JWT_SECRET'),
  });
  const cookies = new Map(
    [buyer, seller, outsider].map((user) => [
      user.id,
      `access_token=${jwt.sign({ sub: user.id, email: user.email })}`,
    ]),
  );

  return {
    app,
    dataSource,
    cloudinary,
    buyer,
    seller,
    outsider,
    product,
    cookieFor: (user) => cookies.get(user.id)!,
  };
}
