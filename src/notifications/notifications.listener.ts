import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
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

      // Vendido: a quienes lo guardaron, solo si estaba disponible (el
      // checkout exige activo, pero no visible). Sin comprador ni vendedor.
      if (row.product_visible && !row.product_deleted_at) {
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
