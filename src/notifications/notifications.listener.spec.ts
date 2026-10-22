import { DataSource } from 'typeorm';
import { NotificationType } from './enums/notification-type.enum';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';

describe('NotificationsListener', () => {
  let listener: NotificationsListener;
  let query: jest.Mock;
  let notify: jest.Mock;
  let logError: jest.SpyInstance;

  beforeEach(() => {
    query = jest.fn();
    notify = jest.fn().mockResolvedValue([]);
    listener = new NotificationsListener(
      { notify } as unknown as NotificationsService,
      { query } as unknown as DataSource,
    );
    logError = jest
      .spyOn(
        (listener as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
  });

  describe('safely', () => {
    it('loguea el error y no lo propaga', async () => {
      await expect(
        listener.safely('evento', () => Promise.reject(new Error('falló'))),
      ).resolves.toBeUndefined();
      expect(logError).toHaveBeenCalled();
    });
  });

  describe('payment.checkout.completed', () => {
    const event = {
      transactionId: 'tx-1',
      productId: 22,
      buyerId: 'buyer-id',
      sellerId: 4,
      amount: 25000,
      currency: 'CRC',
    };

    it('notifica compra al comprador y venta al vendedor (resuelto desde seller_id)', async () => {
      query.mockResolvedValue([
        {
          product_title: 'Goku',
          seller_user_id: 'seller-user',
          seller_name: 'Funko Corner',
          buyer_username: 'ana',
        },
      ]);

      await listener.onCheckoutCompleted(event);

      expect(query).toHaveBeenCalledWith(expect.any(String), [
        22,
        4,
        'buyer-id',
      ]);
      expect(notify).toHaveBeenCalledWith([
        expect.objectContaining({
          userId: 'buyer-id',
          type: NotificationType.PURCHASE_COMPLETED,
          data: {
            transactionId: 'tx-1',
            productId: 22,
            productTitle: 'Goku',
            amount: 25000,
            currency: 'CRC',
            sellerName: 'Funko Corner',
          },
        }),
        expect.objectContaining({
          userId: 'seller-user',
          type: NotificationType.SALE_COMPLETED,
          data: expect.objectContaining({ buyerUsername: 'ana' }) as unknown,
        }),
      ]);
    });

    it('un fallo al consultar no rompe nada', async () => {
      query.mockRejectedValue(new Error('db caída'));

      await expect(
        listener.onCheckoutCompleted(event),
      ).resolves.toBeUndefined();
      expect(notify).not.toHaveBeenCalled();
      expect(logError).toHaveBeenCalled();
    });
  });
});
