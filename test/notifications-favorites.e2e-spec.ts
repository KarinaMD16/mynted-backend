import request from 'supertest';
import { Category } from '../src/community/entities/category.entity';
import {
  CommunityProfile,
  CommunityProfileRole,
} from '../src/community/entities/community-profile.entity';
import { Community } from '../src/community/entities/community.entity';
import {
  Favorite,
  FavoriteItemType,
} from '../src/community/entities/favorite.entity';
import { CommunityModule } from '../src/community/community.module';
import { Notification } from '../src/notifications/entities/notification.entity';
import { NotificationType } from '../src/notifications/enums/notification-type.enum';
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
 * Tarea 1044 contra Postgres real: preferencias de aviso en favoritos y
 * notificaciones de precio y disponibilidad (unificación, comunidades
 * privadas, actor excluido y muchos favoritos).
 */
jest.setTimeout(90_000);

describe('Favoritos con aviso (e2e)', () => {
  let ctx: NotificationsTestApp;
  let seller: User;
  let priceFan: User;
  let availabilityFan: User;
  let quietFan: User;
  let inactiveFan: User;
  let member: User;
  let outsider: User;
  let product: Product;
  let privateProduct: Product;
  let store: Seller;

  const http = () => request(ctx.app.getHttpServer());
  const as = (user: User) => ({ Cookie: ctx.cookieFor(user) });
  const notificationsOf = (user: User) =>
    ctx.repo(Notification).find({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });
  const pause = (ms = 400) => new Promise((r) => setTimeout(r, ms));
  const editProduct = (id: number, body: Record<string, unknown>) =>
    http().patch(`/products/${id}`).set(as(seller)).send(body).expect(200);
  const setStatus = (id: number, status: ProductStatus) =>
    http()
      .patch(`/products/${id}/status`)
      .set(as(seller))
      .send({ status })
      .expect(200);
  const favorite = (
    user: User,
    productId: number,
    flags: { notifyPrice?: boolean; notifyAvailability?: boolean } = {},
  ) =>
    ctx.repo(Favorite).save({
      userId: user.id,
      itemId: productId,
      itemType: FavoriteItemType.PRODUCT,
      notifyPrice: flags.notifyPrice ?? false,
      notifyAvailability: flags.notifyAvailability ?? false,
    });
  const newProduct = (values: Partial<Product> = {}) =>
    ctx.repo(Product).save({
      title: 'Goku',
      description: 'Nuevo',
      price: 100,
      currency: 'CRC',
      imageUrl: 'https://res.cloudinary.com/mynted/cover.png',
      status: ProductStatus.ACTIVE,
      type: ProductType.SALE,
      condition: ProductCondition.NEW,
      sellerId: store.sellerId,
      ...values,
    });

  beforeAll(async () => {
    ctx = await createNotificationsTestApp([ProductsModule, CommunityModule]);
    const users = ctx.repo(User);
    [
      seller,
      priceFan,
      availabilityFan,
      quietFan,
      inactiveFan,
      member,
      outsider,
    ] = await users.save([
      users.create({
        email: 'seller@e2e.test',
        username: 'karina',
        role: UserRole.SELLER,
        sellerRequestStatus: SellerRequestStatus.APPROVED,
        currency: 'CRC',
      }),
      users.create({ email: 'price@e2e.test', username: 'precio' }),
      users.create({ email: 'avail@e2e.test', username: 'dispo' }),
      users.create({ email: 'quiet@e2e.test', username: 'callado' }),
      users.create({
        email: 'off@e2e.test',
        username: 'inactivo',
        isActive: false,
      }),
      users.create({ email: 'member@e2e.test', username: 'miembro' }),
      users.create({ email: 'out@e2e.test', username: 'externo' }),
    ]);
    const paymentInfo = await ctx.repo(PaymentInfo).save({
      ownerFullName: 'Karina',
      name: 'BN',
      number: 'CR000000000000000000',
      type: PaymentType.BANK_ACCOUNT,
    });
    store = await ctx.repo(Seller).save({
      displayName: 'Funko Corner',
      description: 'Funkos',
      location: 'San José',
      isVerified: true,
      userId: seller.id,
      paymentId: paymentInfo.paymentInfoId,
    });

    const category = await ctx.repo(Category).save({ name: 'Colección' });
    const secret = await ctx.repo(Community).save({
      name: 'Secreta',
      description: 'Privada',
      slug: 'secreta-e2e',
      isPrivate: true,
      categoryId: category.categoryId,
    });
    await ctx.repo(CommunityProfile).save([
      {
        userId: seller.id,
        communityId: secret.id,
        role: CommunityProfileRole.OWNER,
        displayName: 'karina',
        bio: '',
      },
      {
        userId: member.id,
        communityId: secret.id,
        role: CommunityProfileRole.MEMBER,
        displayName: 'miembro',
        bio: '',
      },
    ]);

    product = await newProduct();
    privateProduct = await newProduct({
      title: 'Secreto',
      communityId: secret.id,
    });
  });

  afterAll(async () => {
    await ctx?.close();
  });

  describe('preferencias en favoritos', () => {
    it('PUT acepta los avisos y GET /favorites/me/ids los expone', async () => {
      const saved = await http()
        .put(`/products/${product.id}/favorite`)
        .set(as(priceFan))
        .send({ notifyPrice: true })
        .expect(200);
      expect(saved.body).toEqual({
        itemId: product.id,
        itemType: 'PRODUCT',
        isSaved: true,
        notifyPrice: true,
        notifyAvailability: false,
      });

      // Sin body sigue funcionando y no cambia los avisos.
      await http()
        .put(`/products/${product.id}/favorite`)
        .set(as(priceFan))
        .expect(200)
        .expect((res) => expect(res.body).toMatchObject({ notifyPrice: true }));

      const ids = await http()
        .get('/favorites/me/ids?type=products')
        .set(as(priceFan))
        .expect(200);
      expect(ids.body).toEqual({
        type: 'products',
        ids: [product.id],
        items: [
          { id: product.id, notifyPrice: true, notifyAvailability: false },
        ],
      });
    });

    it('PATCH cambia los avisos; 404 si no está en favoritos y 400 sin campos', async () => {
      await http()
        .put(`/products/${product.id}/favorite`)
        .set(as(availabilityFan))
        .expect(200);
      await http()
        .patch(`/products/${product.id}/favorite`)
        .set(as(availabilityFan))
        .send({ notifyAvailability: true })
        .expect(200)
        .expect((res) =>
          expect(res.body).toMatchObject({
            notifyPrice: false,
            notifyAvailability: true,
          }),
        );

      await http()
        .patch(`/products/${product.id}/favorite`)
        .set(as(quietFan))
        .send({ notifyPrice: true })
        .expect(404);
      await http()
        .patch(`/products/${product.id}/favorite`)
        .set(as(availabilityFan))
        .send({})
        .expect(400);
      await http()
        .patch(`/products/${product.id}/favorite`)
        .set(as(availabilityFan))
        .send({ notifyPrice: 'si' })
        .expect(400);
    });

    it('GET /favorites/me trae los avisos en la tarjeta del producto', async () => {
      const res = await http()
        .get('/favorites/me?type=products')
        .set(as(priceFan))
        .expect(200);

      expect(
        (res.body as { data: { product: unknown }[] }).data[0].product,
      ).toMatchObject({
        id: product.id,
        isSaved: true,
        notifyPrice: true,
        notifyAvailability: false,
      });
    });

    it('un producto de comunidad privada solo lo guardan sus miembros', async () => {
      await http()
        .put(`/products/${privateProduct.id}/favorite`)
        .set(as(outsider))
        .expect(404);
      await http()
        .put(`/products/${privateProduct.id}/favorite`)
        .set(as(member))
        .send({ notifyPrice: true })
        .expect(200);
    });
  });

  describe('precio', () => {
    beforeAll(async () => {
      await favorite(quietFan, product.id);
      await favorite(inactiveFan, product.id, {
        notifyPrice: true,
        notifyAvailability: true,
      });
      // El propio vendedor (autor del cambio) nunca recibe el aviso.
      await favorite(seller, product.id, {
        notifyPrice: true,
        notifyAvailability: true,
      });
    });

    it('no avisa si no cambia el precio final', async () => {
      await editProduct(product.id, { title: 'Goku SSJ' });
      // 200 con 50 % de descuento sigue siendo 100.
      await editProduct(product.id, { price: 200, discountPercent: 50 });
      await pause();

      expect(await ctx.repo(Notification).count()).toBe(0);
    });

    it('avisa solo a quien pidió aviso de precio, con previousPrice y newPrice', async () => {
      await editProduct(product.id, { discountPercent: 55 });

      await ctx.waitFor(async () => {
        expect(await notificationsOf(priceFan)).toHaveLength(1);
      });
      const [notification] = await notificationsOf(priceFan);
      expect(notification).toMatchObject({
        type: NotificationType.FAVORITE_PRICE_CHANGED,
        data: {
          productId: product.id,
          productTitle: 'Goku SSJ',
          previousPrice: 100,
          newPrice: 90,
          currency: 'CRC',
        },
      });
      await pause();
      for (const user of [availabilityFan, quietFan, inactiveFan, seller]) {
        expect(await notificationsOf(user)).toHaveLength(0);
      }
    });

    it('unifica los cambios seguidos y conserva el primer previousPrice', async () => {
      const [first] = await notificationsOf(priceFan);

      await editProduct(product.id, { discountPercent: 60 });

      await ctx.waitFor(async () => {
        const [merged] = await notificationsOf(priceFan);
        expect(merged.data).toMatchObject({
          previousPrice: 100,
          newPrice: 80,
        });
      });
      const all = await notificationsOf(priceFan);
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(first.id);
    });

    it('si vuelve al precio que el usuario vio, la notificación se descarta', async () => {
      await editProduct(product.id, { discountPercent: 50 });

      await ctx.waitFor(async () => {
        expect(await notificationsOf(priceFan)).toHaveLength(0);
      });
    });

    it('en comunidad privada solo avisa a quien todavía tiene acceso', async () => {
      // outsider la guardó antes de que la comunidad (o el producto) fuera
      // privada.
      await favorite(outsider, privateProduct.id, { notifyPrice: true });

      await editProduct(privateProduct.id, { price: 50 });

      await ctx.waitFor(async () => {
        expect(await notificationsOf(member)).toHaveLength(1);
      });
      await pause();
      expect(await notificationsOf(outsider)).toHaveLength(0);
    });

    it('con muchos favoritos crea todas las notificaciones en una sola inserción', async () => {
      const crowd = await ctx.repo(User).save(
        Array.from({ length: 300 }, (_, i) =>
          ctx.repo(User).create({
            email: `fan${i}@e2e.test`,
            username: `fan${i}`,
          }),
        ),
      );
      const popular = await newProduct({ title: 'Popular' });
      await ctx.repo(Favorite).insert(
        crowd.map((user) => ({
          userId: user.id,
          itemId: popular.id,
          itemType: FavoriteItemType.PRODUCT,
          notifyPrice: true,
        })),
      );

      await editProduct(popular.id, { price: 70 });

      await ctx.waitFor(async () => {
        expect(
          await ctx.repo(Notification).count({
            where: { type: NotificationType.FAVORITE_PRICE_CHANGED },
          }),
        ).toBe(301); // 300 + el miembro de la comunidad privada
      }, 10_000);
    });
  });

  describe('disponibilidad', () => {
    const latestOf = async (user: User) => (await notificationsOf(user))[0];

    beforeAll(async () => {
      await ctx.repo(Notification).clear();
    });

    it('avisa al pausar y unifica al reactivar (vuelve a estar disponible)', async () => {
      await setStatus(product.id, ProductStatus.INACTIVE);
      await ctx.waitFor(async () => {
        expect(await latestOf(availabilityFan)).toMatchObject({
          type: NotificationType.FAVORITE_UNAVAILABLE,
          data: { productId: product.id, reason: 'inactive' },
        });
      });

      await setStatus(product.id, ProductStatus.ACTIVE);
      await ctx.waitFor(async () => {
        const all = await notificationsOf(availabilityFan);
        expect(all).toHaveLength(1);
        expect(all[0].type).toBe(NotificationType.FAVORITE_AVAILABLE_AGAIN);
        expect(all[0].data).not.toHaveProperty('reason');
      });
      expect(await notificationsOf(priceFan)).toHaveLength(0);
      expect(await notificationsOf(seller)).toHaveLength(0);
    });

    it('ocultar cuenta como no disponible; cambios sin transición real no avisan', async () => {
      const [current] = await notificationsOf(availabilityFan);
      await http()
        .patch(`/notifications/${current.id}/read`)
        .set(as(availabilityFan))
        .expect(200);

      await editProduct(product.id, { isVisible: false });
      await ctx.waitFor(async () => {
        expect(await latestOf(availabilityFan)).toMatchObject({
          type: NotificationType.FAVORITE_UNAVAILABLE,
          data: { reason: 'hidden' },
          readAt: null,
        });
      });

      // Oculto → pausado y pausado → visible: sigue no disponible.
      await setStatus(product.id, ProductStatus.INACTIVE);
      await editProduct(product.id, { isVisible: true });
      await pause();
      const unread = (await notificationsOf(availabilityFan)).filter(
        (n) => n.readAt === null,
      );
      expect(unread).toHaveLength(1);
      expect(unread[0].data).toMatchObject({ reason: 'hidden' });
    });

    it('el borrado lógico avisa y luego se puede quitar de favoritos', async () => {
      await setStatus(product.id, ProductStatus.ACTIVE);
      await ctx.repo(Notification).clear();

      await http()
        .delete(`/products/${product.id}`)
        .set(as(seller))
        .expect(204);
      await ctx.waitFor(async () => {
        expect(await latestOf(availabilityFan)).toMatchObject({
          type: NotificationType.FAVORITE_UNAVAILABLE,
          data: { reason: 'deleted' },
        });
      });

      // Antes respondía 404 si el producto ya no estaba activo.
      await http()
        .delete(`/products/${product.id}/favorite`)
        .set(as(availabilityFan))
        .expect(200)
        .expect((res) => expect(res.body).toMatchObject({ isSaved: false }));
      // Y se pueden apagar los avisos de un producto que ya no está activo.
      await http()
        .patch(`/products/${product.id}/favorite`)
        .set(as(priceFan))
        .send({ notifyPrice: false })
        .expect(200);
    });
  });
});
