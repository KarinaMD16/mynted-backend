import request from 'supertest';
import { Category } from '../src/community/entities/category.entity';
import {
  CommunityProfile,
  CommunityProfileRole,
} from '../src/community/entities/community-profile.entity';
import { Community } from '../src/community/entities/community.entity';
import { Post } from '../src/community/entities/post.entity';
import { Notification } from '../src/notifications/entities/notification.entity';
import { NotificationType } from '../src/notifications/enums/notification-type.enum';
import { PaymentTransaction } from '../src/payments/entities/payment-transaction.entity';
import { TransactionStatus } from '../src/payments/enums/transaction-status.enum';
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
import { SellersModule } from '../src/sellers/sellers.module';
import { UserCommunitiesModule } from '../src/user-communities/user-communities.module';
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
 * Eventos simples contra Postgres real y por HTTP: solicitud de vendedor,
 * solicitudes de unión, reseñas y respuestas del foro.
 */
jest.setTimeout(90_000);

describe('Notificaciones de eventos simples (e2e)', () => {
  let ctx: NotificationsTestApp;

  const http = () => request(ctx.app.getHttpServer());
  const as = (user: User) => ({ Cookie: ctx.cookieFor(user) });
  const notificationsOf = (user: User) =>
    ctx.repo(Notification).find({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });
  const typesOf = async (user: User) =>
    (await notificationsOf(user)).map((n) => n.type);
  const pause = (ms = 400) => new Promise((r) => setTimeout(r, ms));
  const newUser = (username: string, values: Partial<User> = {}) =>
    ctx.repo(User).save(
      ctx.repo(User).create({
        email: `${username}@e2e.test`,
        username,
        ...values,
      }),
    );
  const newStore = async (user: User, values: Partial<Seller> = {}) => {
    const paymentInfo = await ctx.repo(PaymentInfo).save({
      ownerFullName: user.username,
      name: 'BN',
      number: 'CR000000000000000000',
      type: PaymentType.BANK_ACCOUNT,
    });
    return ctx.repo(Seller).save({
      displayName: `Tienda ${user.username}`,
      description: 'Funkos',
      location: 'San José',
      userId: user.id,
      paymentId: paymentInfo.paymentInfoId,
      ...values,
    });
  };

  let admin: User;
  let category: Category;

  beforeAll(async () => {
    ctx = await createNotificationsTestApp([
      SellersModule,
      UserCommunitiesModule,
      ProductsModule,
    ]);
    admin = await newUser('admin', { role: UserRole.SUPERADMIN });
    category = await ctx.repo(Category).save({ name: 'Colección' });
  });

  afterAll(async () => {
    await ctx?.close();
  });

  describe('solicitud de vendedor', () => {
    it('avisa la aprobación (con la tienda) y el rechazo', async () => {
      const approved = await newUser('aprobada', {
        sellerRequestStatus: SellerRequestStatus.PENDING,
        currency: 'CRC',
      });
      const rejected = await newUser('rechazada', {
        sellerRequestStatus: SellerRequestStatus.PENDING,
        currency: 'CRC',
      });
      const store = await newStore(approved);
      await newStore(rejected);

      await http()
        .patch(`/users/${approved.id}/seller-status`)
        .set(as(admin))
        .send({ status: SellerRequestStatus.APPROVED })
        .expect(200);
      await http()
        .patch(`/users/${rejected.id}/seller-status`)
        .set(as(admin))
        .send({ status: SellerRequestStatus.REJECTED })
        .expect(200);

      await ctx.waitFor(async () => {
        expect(await notificationsOf(approved)).toHaveLength(1);
        expect(await notificationsOf(rejected)).toHaveLength(1);
      });
      const [approval] = await notificationsOf(approved);
      expect(approval).toMatchObject({
        type: NotificationType.SELLER_REQUEST_APPROVED,
        data: { sellerId: store.sellerId, displayName: 'Tienda aprobada' },
      });
      await expect(typesOf(rejected)).resolves.toEqual([
        NotificationType.SELLER_REQUEST_REJECTED,
      ]);
      await expect(typesOf(admin)).resolves.toEqual([]);
    });
  });

  describe('solicitudes de unión a comunidades privadas', () => {
    let owner: User;
    let moderator: User;
    let member: User;
    let community: Community;

    beforeAll(async () => {
      [owner, moderator, member] = await Promise.all([
        newUser('duena'),
        newUser('moderadora'),
        newUser('miembra'),
      ]);
      community = await ctx.repo(Community).save({
        name: 'Secreta',
        description: 'Privada',
        slug: 'secreta-eventos',
        isPrivate: true,
        categoryId: category.categoryId,
      });
      await ctx.repo(CommunityProfile).save(
        [
          [owner, CommunityProfileRole.OWNER],
          [moderator, CommunityProfileRole.MODERATOR],
          [member, CommunityProfileRole.MEMBER],
        ].map(([user, role]) => ({
          userId: (user as User).id,
          communityId: community.id,
          role: role as CommunityProfileRole,
          displayName: (user as User).username,
          bio: '',
        })),
      );
    });

    it('avisa a owner y moderadores (no a miembros ni a quien la pide) y luego al resolverla', async () => {
      const applicant = await newUser('aspirante');
      const other = await newUser('otra');

      await http()
        .post(`/communities/${community.id}/join`)
        .set(as(applicant))
        .expect(201);
      await http()
        .post(`/communities/${community.id}/join`)
        .set(as(other))
        .expect(201);

      await ctx.waitFor(async () => {
        expect(await notificationsOf(owner)).toHaveLength(2);
        expect(await notificationsOf(moderator)).toHaveLength(2);
      });
      const [latest] = await notificationsOf(owner);
      expect(latest).toMatchObject({
        type: NotificationType.COMMUNITY_JOIN_REQUESTED,
        data: {
          communityId: community.id,
          communityName: 'Secreta',
          communitySlug: 'secreta-eventos',
          requesterId: other.id,
          requesterUsername: 'otra',
        },
      });
      await expect(typesOf(member)).resolves.toEqual([]);
      await expect(typesOf(applicant)).resolves.toEqual([]);

      const requests = await notificationsOf(owner);
      const idFor = (user: User) =>
        requests.find((n) => n.data.requesterId === user.id)!.data
          .requestId as number;

      await http()
        .patch(
          `/communities/${community.id}/join-requests/${idFor(applicant)}/accept`,
        )
        .set(as(moderator))
        .expect(200);
      await http()
        .patch(
          `/communities/${community.id}/join-requests/${idFor(other)}/reject`,
        )
        .set(as(owner))
        .expect(200);

      await ctx.waitFor(async () => {
        await expect(typesOf(applicant)).resolves.toEqual([
          NotificationType.COMMUNITY_JOIN_ACCEPTED,
        ]);
        await expect(typesOf(other)).resolves.toEqual([
          NotificationType.COMMUNITY_JOIN_REJECTED,
        ]);
      });
      const [accepted] = await notificationsOf(applicant);
      expect(accepted.data).toMatchObject({
        communityId: community.id,
        communityName: 'Secreta',
      });
    });
  });

  describe('reseñas', () => {
    it('avisa al vendedor con el producto, el rating y quién reseñó', async () => {
      const seller = await newUser('vendedora', { role: UserRole.SELLER });
      const buyer = await newUser('compradora');
      const store = await newStore(seller, { isVerified: true });
      const product = await ctx.repo(Product).save({
        title: 'Goku',
        description: 'Nuevo',
        price: 100,
        currency: 'CRC',
        imageUrl: 'https://res.cloudinary.com/mynted/cover.png',
        status: ProductStatus.SOLD,
        type: ProductType.SALE,
        condition: ProductCondition.NEW,
        sellerId: store.sellerId,
      });
      await ctx.repo(PaymentTransaction).save({
        productId: product.id,
        buyerId: buyer.id,
        sellerId: store.sellerId,
        amount: 100,
        currency: 'CRC',
        salesTierName: 'Bronce',
        salesDiscount: 0,
        priceTierName: 'Bajo',
        priceDiscount: 0,
        commissionRate: 0.05,
        commissionAmount: 5,
        sellerNet: 95,
        status: TransactionStatus.COMPLETED,
        idempotencyKey: 'review-notif-0001',
      });

      const res = await http()
        .post(`/products/${product.id}/reviews`)
        .set(as(buyer))
        .send({ rating: 5, comment: 'Excelente' })
        .expect(201);

      await ctx.waitFor(async () => {
        expect(await notificationsOf(seller)).toHaveLength(1);
      });
      const [review] = await notificationsOf(seller);
      expect(review).toMatchObject({
        type: NotificationType.REVIEW_RECEIVED,
        data: {
          reviewId: (res.body as { id: number }).id,
          productId: product.id,
          productTitle: 'Goku',
          rating: 5,
          authorUsername: 'compradora',
        },
      });
      expect(review.data).not.toHaveProperty('comment');
      await expect(typesOf(buyer)).resolves.toEqual([]);
    });
  });

  describe('respuestas del foro', () => {
    let author: User;
    let replier: User;
    let third: User;
    let post: Post;

    beforeAll(async () => {
      [author, replier, third] = await Promise.all([
        newUser('autora'),
        newUser('respondona'),
        newUser('tercera'),
      ]);
      const forum = await ctx.repo(Community).save({
        name: 'Foro',
        description: 'Público',
        slug: 'foro-eventos',
        isPrivate: false,
        categoryId: category.categoryId,
      });
      const profiles = await ctx.repo(CommunityProfile).save(
        [author, replier, third].map((user) => ({
          userId: user.id,
          communityId: forum.id,
          role: CommunityProfileRole.MEMBER,
          displayName: user.username,
          bio: '',
        })),
      );
      post = await ctx.repo(Post).save({
        title: '¿Cuál es su Funko favorito?',
        body: 'Cuenten',
        communityProfileId: profiles[0].communityProfileId,
      });
    });

    const reply = async (user: User, parentReplyId?: number) =>
      (
        (
          await http()
            .post(`/posts/${post.id}/replies`)
            .set(as(user))
            .send({ body: 'Hola', ...(parentReplyId ? { parentReplyId } : {}) })
            .expect(201)
        ).body as { id: number }
      ).id;

    it('avisa al autor del post; responderse a sí mismo no avisa', async () => {
      const replyId = await reply(replier);
      await reply(author);

      await ctx.waitFor(async () => {
        expect(await notificationsOf(author)).toHaveLength(1);
      });
      const [notification] = await notificationsOf(author);
      expect(notification).toMatchObject({
        type: NotificationType.POST_REPLIED,
        data: {
          postId: post.id,
          postTitle: '¿Cuál es su Funko favorito?',
          replyId,
          communitySlug: 'foro-eventos',
          authorUsername: 'respondona',
        },
      });
      await pause();
      expect(await notificationsOf(author)).toHaveLength(1);
    });

    it('al responder una respuesta avisa a su autor y al del post, sin duplicar', async () => {
      await ctx.repo(Notification).clear();
      const replierReply = await reply(replier);
      await ctx.waitFor(async () => {
        expect(await notificationsOf(author)).toHaveLength(1);
      });
      await ctx.repo(Notification).clear();

      // Tercera responde a respondona: avisa a ambas (reply_replied y
      // post_replied).
      await reply(third, replierReply);
      await ctx.waitFor(async () => {
        await expect(typesOf(replier)).resolves.toEqual([
          NotificationType.REPLY_REPLIED,
        ]);
        await expect(typesOf(author)).resolves.toEqual([
          NotificationType.POST_REPLIED,
        ]);
      });

      // Tercera responde a la autora del post: una sola (reply_replied).
      await ctx.repo(Notification).clear();
      const authorReply = await reply(author);
      await reply(third, authorReply);
      await ctx.waitFor(async () => {
        await expect(typesOf(author)).resolves.toEqual([
          NotificationType.REPLY_REPLIED,
        ]);
      });
      await pause();
      await expect(typesOf(author)).resolves.toEqual([
        NotificationType.REPLY_REPLIED,
      ]);
      await expect(typesOf(third)).resolves.toEqual([]);
    });
  });
});
