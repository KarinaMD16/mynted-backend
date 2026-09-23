import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { CommunityModule } from './community/community.module';
import { UserTagsModule } from './user-tags/user-tags.module';
import { UserCommunitiesModule } from './user-communities/user-communities.module';
import { SellersModule } from './sellers/sellers.module';
import { ProductsModule } from './products/products.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: Number(config.get<string>('DB_PORT')),
        username: config.get<string>('DB_USERNAME'),
        password: String(config.get('DB_PASSWORD')),
        database: config.get<string>('DB_NAME'),

        autoLoadEntities: true,

        // Solo desarrollo
        synchronize: true,
      }),
    }),
    // SellersModule antes que UsersModule: ambos comparten el prefijo
    // 'users' y SellersController registra rutas literales
    // (seller-requests, seller-request/:id) que un GET /users/:id
    // registrado primero interceptaría (Express/Nest matchean rutas en
    // orden de registro, no por especificidad).
    SellersModule,
    UsersModule,
    AuthModule,
    CommunityModule,
    UserTagsModule,
    UserCommunitiesModule,
    ProductsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
