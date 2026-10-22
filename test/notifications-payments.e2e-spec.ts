import request from 'supertest';
import {
  Favorite,
  FavoriteItemType,
} from '../src/community/entities/favorite.entity';
import { Notification } from '../src/notifications/entities/notification.entity';
import { NotificationType } from '../src/notifications/enums/notification-type.enum';
import {
  NotificationNewPayload,
  NotificationSocketEvents,
} from '../src/notifications/notifications.gateway';
import {
  Product,
  ProductCondition,
  ProductStatus,
  ProductType,
} from '../src/products/entities/product.entity';
import {
  PaymentInfo,
  PaymentType,
} from '../src/sellers/entities/payment-info.entity';
import { Seller } from '../src/sellers/entities/seller.entity';
import { User, UserRole } from '../src/users/entities/user.entity';
import {
  createNotificationsTestApp,
  NotificationsTestApp,
} from './utils/notifications-test-app';

/**
 * payment.checkout.completed con un checkout real (pasarela simulada):
 * notifica compra al comprador y venta al vendedor, y repetir la clave de
 * idempotencia no vuelve a notificar.
 */
jest.setTimeout(60_000);

describe('Notificaciones de pagos (e2e)', () => {
  let ctx: NotificationsTestApp;
  let buyer: User;
  let sellerUser: User;
  let fan: User;
  let product: Product;

  const checkout = (idempotencyKey: string) =>
    request(ctx.app.getHttpServer())
      .post('/payments/checkout')
      .set({ Cookie: ctx.cookieFor(buyer), 'Idempotency-Key': idempotencyKey })
      .send({
        productId: product.id,
        card: {
          cardNumber: '4242424242424242',
          expiryMonth: 12,
          expiryYear: 2099,
          cvv: '123',
          cardHolderName: 'Ana Compradora',
        },
      });
  const notificationsOf = (user: User) =>
    ctx.repo(Notification).find({ where: { userId: user.id } });

  beforeAll(async () => {
    ctx = await createNotificationsTestApp();
    const users = ctx.repo(User);
    [buyer, sellerUser, fan] = await users.save([
      users.create({ email: 'buyer@e2e.test', username: 'compradora' }),
      users.create({
        email: 'seller@e2e.test',
        username: 'karina',
        role: UserRole.SELLER,
        currency: 'CRC',
      }),
      users.create({ email: 'fan@e2e.test', username: 'fan' }),
    ]);
    const paymentInfo = await ctx.repo(PaymentInfo).save({
      ownerFullName: 'Karina',
      name: 'BN',
      number: 'CR000000000000000000',
      type: PaymentType.BANK_ACCOUNT,
    });
    const store = await ctx.repo(Seller).save({
      displayName: 'Funko Corner',
      description: 'Funkos',
      location: 'San José',
      isVerified: true,
      userId: sellerUser.id,
      paymentId: paymentInfo.paymentInfoId,
    });
    product = await ctx.repo(Product).save({
      title: 'Funko Pop Goku SSJ',
      description: 'Nuevo',
      price: 25000,
      currency: 'CRC',
      imageUrl: 'https://res.cloudinary.com/mynted/cover.png',
      status: ProductStatus.ACTIVE,
      type: ProductType.SALE,
      condition: ProductCondition.NEW,
      sellerId: store.sellerId,
    });
    // El fan y la propia compradora lo tenían en favoritos con aviso.
    await ctx.repo(Favorite).insert(
      [fan, buyer].map((user) => ({
        userId: user.id,
        itemId: product.id,
        itemType: FavoriteItemType.PRODUCT,
        notifyAvailability: true,
      })),
    );
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('notifica compra al comprador y venta al vendedor, en vivo', async () => {
    const sellerSocket = await ctx.connect(sellerUser);
    const live = ctx.next<NotificationNewPayload>(
      sellerSocket,
      NotificationSocketEvents.NEW,
      5000,
    );

    const res = await checkout('checkout-notif-0001').expect(201);
    const transactionId = (res.body as { id: string }).id;

    await ctx.waitFor(async () => {
      expect(await notificationsOf(buyer)).toHaveLength(1);
      expect(await notificationsOf(sellerUser)).toHaveLength(1);
    });
    const [purchase] = await notificationsOf(buyer);
    expect(purchase).toMatchObject({
      type: NotificationType.PURCHASE_COMPLETED,
      data: {
        transactionId,
        productId: product.id,
        productTitle: 'Funko Pop Goku SSJ',
        amount: 25000,
        currency: 'CRC',
        sellerName: 'Funko Corner',
      },
    });
    await expect(live).resolves.toMatchObject({
      unreadCount: 1,
      notification: {
        type: NotificationType.SALE_COMPLETED,
        data: { transactionId, buyerUsername: 'compradora', amount: 25000 },
      },
    });
  });

  it('avisa "vendido" a quien lo guardó, pero no a la compradora', async () => {
    await ctx.waitFor(async () => {
      expect(await notificationsOf(fan)).toHaveLength(1);
    });
    const [sold] = await notificationsOf(fan);
    expect(sold).toMatchObject({
      type: NotificationType.FAVORITE_UNAVAILABLE,
      data: {
        productId: product.id,
        productTitle: 'Funko Pop Goku SSJ',
        reason: 'sold',
      },
    });
    const buyerTypes = (await notificationsOf(buyer)).map((n) => n.type);
    expect(buyerTypes).toEqual([NotificationType.PURCHASE_COMPLETED]);
  });

  it('repetir la clave de idempotencia no vuelve a notificar', async () => {
    await checkout('checkout-notif-0001').expect(201);
    // Margen para que un listener (si se hubiera emitido) termine.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(await notificationsOf(buyer)).toHaveLength(1);
    expect(await notificationsOf(sellerUser)).toHaveLength(1);
    expect(await notificationsOf(fan)).toHaveLength(1);
  });
});
