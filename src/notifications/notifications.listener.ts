import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import {
  BadgeAwardedEvent,
  BadgeAwardEvents,
  BadgeEvents,
  ReplyCreatedEvent,
  SellerApprovedEvent,
} from '../badges/badge-events';
import {
  CommunityEvents,
  JoinRequestCreatedEvent,
  JoinRequestResolvedEvent,
} from '../community/community-events';
import {
  CheckoutCompletedEvent,
  PaymentEvents,
} from '../payments/payment-events';
import {
  ProductAvailabilityChangedEvent,
  ProductEvents,
  ProductPriceChangedEvent,
  UnavailableReason,
} from '../products/product-events';
import { ReviewCreatedEvent, ReviewEvents } from '../products/review-events';
import { SellerEvents, SellerRejectedEvent } from '../sellers/seller-events';
import { NotificationInput } from './notifications.service';
import { NotificationType } from './enums/notification-type.enum';
import { NotificationsService } from './notifications.service';

/**
 * Traduce eventos de dominio (EventEmitter2) en notificaciones. Los
 * handlers son asíncronos ({ async: true }) y van envueltos en safely():
 * igual que en BadgesListener, un fallo se loguea y nunca rompe la request
 * que emitió el evento.
 */
@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  // Compra (comprador) y venta (vendedor, resuelto desde seller_id).
  @OnEvent(PaymentEvents.CHECKOUT_COMPLETED, { async: true })
  onCheckoutCompleted(event: CheckoutCompletedEvent) {
    return this.safely(PaymentEvents.CHECKOUT_COMPLETED, async () => {
      const [row] = await this.dataSource.query<
        {
          product_title: string;
          product_visible: boolean;
          product_deleted_at: Date | null;
          seller_user_id: string;
          seller_name: string;
          buyer_username: string;
        }[]
      >(
        `SELECT p.title AS product_title, p.is_visible AS product_visible,
                p.deleted_at AS product_deleted_at,
                s.user_id AS seller_user_id,
                s.display_name AS seller_name, b.username AS buyer_username
           FROM product p
           JOIN seller s ON s.seller_id = $2
           JOIN users b ON b.id = $3
          WHERE p.id = $1`,
        [event.productId, event.sellerId, event.buyerId],
      );
      if (!row) return;

      const common = {
        transactionId: event.transactionId,
        productId: event.productId,
        productTitle: row.product_title,
        amount: event.amount,
        currency: event.currency,
      };
      await this.notificationsService.notify([
        {
          userId: event.buyerId,
          type: NotificationType.PURCHASE_COMPLETED,
          data: { ...common, sellerName: row.seller_name },
          message: `Compraste "${row.product_title}"`,
        },
        {
          userId: row.seller_user_id,
          type: NotificationType.SALE_COMPLETED,
          data: { ...common, buyerUsername: row.buyer_username },
          message: `Vendiste "${row.product_title}" a ${row.buyer_username}`,
        },
      ]);

      // Agotado: a quienes lo guardaron, solo si este pago se llevó la última
      // unidad (no por cada descuento intermedio de stock) y estaba
      // disponible (el checkout exige activo, pero no visible). Sin comprador
      // ni vendedor.
      if (event.soldOut && row.product_visible && !row.product_deleted_at) {
        await this.notifyAvailability({
          productId: event.productId,
          productTitle: row.product_title,
          available: false,
          reason: 'sold',
          excludeUserIds: [event.buyerId, row.seller_user_id],
        });
      }
    });
  }

  // Favoritos con aviso de precio. Se unifica por producto: conserva el
  // previousPrice de la primera no leída y, si el precio vuelve a ese valor,
  // se descarta.
  @OnEvent(ProductEvents.PRICE_CHANGED, { async: true })
  onProductPriceChanged(event: ProductPriceChangedEvent) {
    return this.safely(ProductEvents.PRICE_CHANGED, () =>
      this.notificationsService.notifyFavoriters({
        productId: event.productId,
        preference: 'price',
        excludeUserIds: [event.actorUserId],
        type: NotificationType.FAVORITE_PRICE_CHANGED,
        data: {
          productId: event.productId,
          productTitle: event.productTitle,
          previousPrice: event.previousPrice,
          newPrice: event.newPrice,
          currency: event.currency,
        },
        message: `Cambió el precio de "${event.productTitle}": ahora ${event.newPrice} ${event.currency}`,
        dedupeKey: `product:${event.productId}:price`,
        preserveKeys: ['previousPrice'],
        discardIf: (data) => data.previousPrice === data.newPrice,
      }),
    );
  }

  @OnEvent(ProductEvents.AVAILABILITY_CHANGED, { async: true })
  onProductAvailabilityChanged(event: ProductAvailabilityChangedEvent) {
    return this.safely(ProductEvents.AVAILABILITY_CHANGED, () =>
      this.notifyAvailability({
        productId: event.productId,
        productTitle: event.productTitle,
        available: event.available,
        reason: event.reason,
        excludeUserIds: [event.actorUserId],
      }),
    );
  }

  // Disponibilidad unificada por producto: la no leída pasa a reflejar el
  // último estado (no disponible o disponible de nuevo).
  private notifyAvailability(input: {
    productId: number;
    productTitle: string;
    available: boolean;
    reason: UnavailableReason | null;
    excludeUserIds: string[];
  }) {
    return this.notificationsService.notifyFavoriters({
      productId: input.productId,
      preference: 'availability',
      excludeUserIds: input.excludeUserIds,
      type: input.available
        ? NotificationType.FAVORITE_AVAILABLE_AGAIN
        : NotificationType.FAVORITE_UNAVAILABLE,
      data: {
        productId: input.productId,
        productTitle: input.productTitle,
        ...(input.available ? {} : { reason: input.reason }),
      },
      message: input.available
        ? `"${input.productTitle}" vuelve a estar disponible`
        : `"${input.productTitle}" ya no está disponible`,
      dedupeKey: `product:${input.productId}:availability`,
    });
  }

  @OnEvent(BadgeEvents.SELLER_APPROVED, { async: true })
  onSellerApproved(event: SellerApprovedEvent) {
    return this.safely(BadgeEvents.SELLER_APPROVED, async () => {
      const [seller] = await this.dataSource.query<
        { seller_id: number; display_name: string }[]
      >('SELECT seller_id, display_name FROM seller WHERE user_id = $1', [
        event.userId,
      ]);
      await this.notificationsService.notify([
        {
          userId: event.userId,
          type: NotificationType.SELLER_REQUEST_APPROVED,
          data: seller
            ? { sellerId: seller.seller_id, displayName: seller.display_name }
            : {},
          message: 'Tu solicitud de vendedor fue aprobada',
        },
      ]);
    });
  }

  @OnEvent(SellerEvents.REJECTED, { async: true })
  onSellerRejected(event: SellerRejectedEvent) {
    return this.safely(SellerEvents.REJECTED, () =>
      this.notificationsService.notify([
        {
          userId: event.userId,
          type: NotificationType.SELLER_REQUEST_REJECTED,
          data: {},
          message: 'Tu solicitud de vendedor fue rechazada',
        },
      ]),
    );
  }

  // A owner y moderadores de la comunidad (nunca a quien la pidió).
  @OnEvent(CommunityEvents.JOIN_REQUEST_CREATED, { async: true })
  onJoinRequestCreated(event: JoinRequestCreatedEvent) {
    return this.safely(CommunityEvents.JOIN_REQUEST_CREATED, async () => {
      const [community] = await this.communityOf(event.communityId);
      if (!community) return;
      const [requester] = await this.dataSource.query<{ username: string }[]>(
        'SELECT username FROM users WHERE id = $1',
        [event.userId],
      );
      const managers = await this.dataSource.query<{ user_id: string }[]>(
        `SELECT user_id FROM community_profile
          WHERE community_id = $1 AND role IN ('owner', 'moderator')
            AND user_id <> $2`,
        [event.communityId, event.userId],
      );
      await this.notificationsService.notify(
        managers.map((manager) => ({
          userId: manager.user_id,
          type: NotificationType.COMMUNITY_JOIN_REQUESTED,
          data: {
            requestId: event.requestId,
            ...community,
            requesterId: event.userId,
            requesterUsername: requester?.username ?? null,
          },
          message: `${requester?.username ?? 'Alguien'} pidió unirse a ${community.communityName}`,
        })),
      );
    });
  }

  @OnEvent(CommunityEvents.JOIN_REQUEST_RESOLVED, { async: true })
  onJoinRequestResolved(event: JoinRequestResolvedEvent) {
    return this.safely(CommunityEvents.JOIN_REQUEST_RESOLVED, async () => {
      if (event.userId === event.resolvedByUserId) return;
      const [community] = await this.communityOf(event.communityId);
      if (!community) return;
      await this.notificationsService.notify([
        {
          userId: event.userId,
          type: event.accepted
            ? NotificationType.COMMUNITY_JOIN_ACCEPTED
            : NotificationType.COMMUNITY_JOIN_REJECTED,
          data: { requestId: event.requestId, ...community },
          message: event.accepted
            ? `Te aceptaron en ${community.communityName}`
            : `Tu solicitud para unirte a ${community.communityName} fue rechazada`,
        },
      ]);
    });
  }

  // Al dueño del producto (nunca a quien reseñó).
  @OnEvent(ReviewEvents.CREATED, { async: true })
  onReviewCreated(event: ReviewCreatedEvent) {
    return this.safely(ReviewEvents.CREATED, async () => {
      if (event.sellerUserId === event.authorId) return;
      const [row] = await this.dataSource.query<
        { product_title: string; author_username: string }[]
      >(
        `SELECT p.title AS product_title, u.username AS author_username
           FROM product p, users u
          WHERE p.id = $1 AND u.id = $2`,
        [event.productId, event.authorId],
      );
      if (!row) return;
      await this.notificationsService.notify([
        {
          userId: event.sellerUserId,
          type: NotificationType.REVIEW_RECEIVED,
          data: {
            reviewId: event.reviewId,
            productId: event.productId,
            productTitle: row.product_title,
            rating: event.rating,
            authorUsername: row.author_username,
          },
          message: `${row.author_username} reseñó "${row.product_title}" con ${event.rating} estrellas`,
        },
      ]);
    });
  }

  // Al autor del post y, si responde a otra respuesta, al autor de esa
  // respuesta. Nunca a quien respondió; si ambos son la misma persona, una
  // sola notificación (reply_replied, la más específica).
  @OnEvent(BadgeEvents.REPLY_CREATED, { async: true })
  onReplyCreated(event: ReplyCreatedEvent) {
    return this.safely(BadgeEvents.REPLY_CREATED, async () => {
      const [row] = await this.dataSource.query<
        {
          post_title: string;
          post_author_id: string;
          community_id: number;
          community_slug: string;
          parent_author_id: string | null;
          author_username: string;
        }[]
      >(
        `SELECT p.title AS post_title, pcp.user_id AS post_author_id,
                c.id AS community_id, c.slug AS community_slug,
                rcp.user_id AS parent_author_id, a.username AS author_username
           FROM post p
           JOIN community_profile pcp
             ON pcp.community_profile_id = p.community_profile_id
           JOIN community c ON c.id = pcp.community_id
           JOIN users a ON a.id = $3
           LEFT JOIN reply r ON r.id = $2
           LEFT JOIN community_profile rcp
             ON rcp.community_profile_id = r.community_profile_id
          WHERE p.id = $1`,
        [event.postId, event.parentReplyId, event.authorUserId],
      );
      if (!row) return;

      const data = {
        postId: event.postId,
        postTitle: row.post_title,
        replyId: event.replyId,
        communityId: row.community_id,
        communitySlug: row.community_slug,
        authorUsername: row.author_username,
      };
      const inputs: NotificationInput[] = [];
      const parentAuthor = row.parent_author_id;
      if (parentAuthor && parentAuthor !== event.authorUserId) {
        inputs.push({
          userId: parentAuthor,
          type: NotificationType.REPLY_REPLIED,
          data: { ...data, parentReplyId: event.parentReplyId },
          message: `${row.author_username} respondió tu comentario en "${row.post_title}"`,
        });
      }
      if (
        row.post_author_id !== event.authorUserId &&
        row.post_author_id !== parentAuthor
      ) {
        inputs.push({
          userId: row.post_author_id,
          type: NotificationType.POST_REPLIED,
          data,
          message: `${row.author_username} respondió tu publicación "${row.post_title}"`,
        });
      }
      await this.notificationsService.notify(inputs);
    });
  }

  // Solo badges otorgados por evento (el cron y el backfill no lo emiten).
  @OnEvent(BadgeAwardEvents.AWARDED, { async: true })
  onBadgeAwarded(event: BadgeAwardedEvent) {
    return this.safely(BadgeAwardEvents.AWARDED, async () => {
      const [community] =
        event.communityId === null
          ? []
          : await this.communityOf(event.communityId);
      await this.notificationsService.notify([
        {
          userId: event.userId,
          type: NotificationType.BADGE_AWARDED,
          data: {
            badgeCode: event.badgeCode,
            badgeName: event.badgeName,
            rarity: event.rarity,
            scope: event.scope,
            ...(community
              ? { communityProfileId: event.communityProfileId, ...community }
              : {}),
          },
          message: community
            ? `Ganaste el badge "${event.badgeName}" en ${community.communityName}`
            : `Ganaste el badge "${event.badgeName}"`,
        },
      ]);
    });
  }

  private communityOf(communityId: number) {
    return this.dataSource.query<
      { communityId: number; communityName: string; communitySlug: string }[]
    >(
      `SELECT id AS "communityId", name AS "communityName",
              slug AS "communitySlug"
         FROM community WHERE id = $1`,
      [communityId],
    );
  }

  async safely(event: string, handler: () => Promise<unknown>): Promise<void> {
    try {
      await handler();
    } catch (error: unknown) {
      this.logger.error(
        `Error generando notificaciones para el evento ${event}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
