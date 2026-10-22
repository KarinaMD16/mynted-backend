import {
  ClassSerializerInterceptor,
  INestApplication,
  ServiceUnavailableException,
  Type,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import cookieParser from 'cookie-parser';
import { Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { io, Socket } from 'socket.io-client';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { JwtStrategy } from '../../src/auth/strategies/jwt.strategy';
import { CloudinaryService } from '../../src/cloudinary/cloudinary.service';
import { ConversationsModule } from '../../src/conversations/conversations.module';
import { NotificationsModule } from '../../src/notifications/notifications.module';
import { ExchangeRateService } from '../../src/payments/exchange-rate/exchange-rate.service';
import { User } from '../../src/users/entities/user.entity';
import { E2E_DB_NAME } from '../e2e-database';

export interface NotificationsTestApp {
  app: INestApplication<App>;
  dataSource: DataSource;
  events: EventEmitter2;
  repo<T extends object>(entity: new () => T): Repository<T>;
  // Cookie "access_token=<jwt>" del usuario, firmada con JWT_SECRET.
  cookieFor(user: User): string;
  // Socket autenticado del usuario (entra a user:{id} al conectar).
  connect(user: User): Promise<Socket>;
  // Espera el próximo evento de socket (falla si no llega a tiempo).
  next<T>(socket: Socket, event: string, timeoutMs?: number): Promise<T>;
  // Reintenta la aserción hasta que pase: los listeners { async: true }
  // terminan después de que respondió la request que emitió el evento.
  waitFor(assertion: () => Promise<void>, timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

/**
 * App para los e2e de notificaciones: ConversationsModule (su ChatGateway
 * autentica el socket y lo une a user:{id}), NotificationsModule y los
 * módulos que emiten los eventos de cada prueba. Recrea el esquema de la base
 * e2e. Cloudinary es un fake y el tipo de cambio es fijo (1 USD = 500 CRC).
 */
export async function createNotificationsTestApp(
  imports: Type[] = [],
): Promise<NotificationsTestApp> {
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
            entities: [join(__dirname, '../../src/**/*.entity.ts')],
            synchronize: true,
            dropSchema: true,
          };
        },
      }),
      PassportModule,
      ConversationsModule,
      NotificationsModule,
      ...imports,
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
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  await app.listen(0);

  const { port } = (app.getHttpServer() as HttpServer).address() as AddressInfo;
  const baseUrl = `http://localhost:${port}`;
  const dataSource = app.get(DataSource);
  const events = app.get(EventEmitter2);
  const jwt = new JwtService({
    secret: app.get(ConfigService).get<string>('JWT_SECRET'),
  });
  const cookieFor = (user: User) =>
    `access_token=${jwt.sign({ sub: user.id, email: user.email })}`;
  const sockets: Socket[] = [];

  return {
    app,
    dataSource,
    events,
    repo: (entity) => dataSource.getRepository(entity),
    cookieFor,
    connect: (user) =>
      new Promise<Socket>((resolve, reject) => {
        const socket = io(baseUrl, {
          transports: ['websocket'],
          reconnection: false,
          extraHeaders: { Cookie: cookieFor(user) },
        });
        sockets.push(socket);
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
      }),
    next: <T>(socket: Socket, event: string, timeoutMs = 3000) =>
      new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`No llegó ${event}`)),
          timeoutMs,
        );
        socket.once(event, (payload: T) => {
          clearTimeout(timer);
          resolve(payload);
        });
      }),
    waitFor: async (assertion, timeoutMs = 3000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        try {
          await assertion();
          return;
        } catch (error) {
          if (Date.now() > deadline) throw error;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
    },
    close: async () => {
      sockets.forEach((socket) => socket.disconnect());
      await app.close();
    },
  };
}
