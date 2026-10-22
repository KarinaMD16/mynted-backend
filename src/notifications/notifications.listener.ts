import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import {
  CheckoutCompletedEvent,
  PaymentEvents,
} from '../payments/payment-events';
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
          seller_user_id: string;
          seller_name: string;
          buyer_username: string;
        }[]
      >(
        `SELECT p.title AS product_title, s.user_id AS seller_user_id,
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
