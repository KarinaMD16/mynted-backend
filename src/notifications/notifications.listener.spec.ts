import { DataSource } from 'typeorm';
import { NotificationType } from './enums/notification-type.enum';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';

describe('NotificationsListener', () => {
  let listener: NotificationsListener;
  let query: jest.Mock;
  let notify: jest.Mock;
  let notifyFavoriters: jest.Mock;
  let logError: jest.SpyInstance;

  beforeEach(() => {
    query = jest.fn();
    notify = jest.fn().mockResolvedValue([]);
    notifyFavoriters = jest.fn().mockResolvedValue([]);
    listener = new NotificationsListener(
      { notify, notifyFavoriters } as unknown as NotificationsService,
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

    const soldRow = (visible: boolean, deletedAt: Date | null = null) => ({
      product_title: 'Goku',
      product_visible: visible,
      product_deleted_at: deletedAt,
      seller_user_id: 'seller-user',
      seller_name: 'Funko Corner',
      buyer_username: 'ana',
    });

    it('avisa "vendido" a los favoritos sin comprador ni vendedor', async () => {
      query.mockResolvedValue([soldRow(true)]);

      await listener.onCheckoutCompleted(event);

      expect(notifyFavoriters).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 22,
          preference: 'availability',
          excludeUserIds: ['buyer-id', 'seller-user'],
          type: NotificationType.FAVORITE_UNAVAILABLE,
          data: { productId: 22, productTitle: 'Goku', reason: 'sold' },
          dedupeKey: 'product:22:availability',
        }),
      );
    });

    it('no avisa "vendido" si el producto ya no estaba disponible (oculto o borrado)', async () => {
      query.mockResolvedValueOnce([soldRow(false)]);
      await listener.onCheckoutCompleted(event);
      query.mockResolvedValueOnce([soldRow(true, new Date())]);
      await listener.onCheckoutCompleted(event);

      expect(notify).toHaveBeenCalledTimes(2);
      expect(notifyFavoriters).not.toHaveBeenCalled();
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

  describe('product.price.changed', () => {
    it('avisa a los favoritos con aviso de precio, unificando y sin el vendedor', async () => {
      await listener.onProductPriceChanged({
        productId: 22,
        actorUserId: 'seller-user',
        productTitle: 'Goku',
        currency: 'CRC',
        previousPrice: 100,
        newPrice: 90,
      });

      expect(notifyFavoriters).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 22,
          preference: 'price',
          excludeUserIds: ['seller-user'],
          type: NotificationType.FAVORITE_PRICE_CHANGED,
          data: {
            productId: 22,
            productTitle: 'Goku',
            previousPrice: 100,
            newPrice: 90,
            currency: 'CRC',
          },
          dedupeKey: 'product:22:price',
          preserveKeys: ['previousPrice'],
        }),
      );
      const [{ discardIf }] = notifyFavoriters.mock.calls[0] as [
        { discardIf: (data: Record<string, unknown>) => boolean },
      ];
      expect(discardIf({ previousPrice: 100, newPrice: 100 })).toBe(true);
      expect(discardIf({ previousPrice: 100, newPrice: 90 })).toBe(false);
    });
  });

  describe('product.availability.changed', () => {
    it('no disponible lleva el motivo; disponible de nuevo no', async () => {
      await listener.onProductAvailabilityChanged({
        productId: 22,
        actorUserId: 'seller-user',
        productTitle: 'Goku',
        available: false,
        reason: 'inactive',
      });
      await listener.onProductAvailabilityChanged({
        productId: 22,
        actorUserId: 'seller-user',
        productTitle: 'Goku',
        available: true,
        reason: null,
      });

      expect(notifyFavoriters).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          type: NotificationType.FAVORITE_UNAVAILABLE,
          data: { productId: 22, productTitle: 'Goku', reason: 'inactive' },
          dedupeKey: 'product:22:availability',
          excludeUserIds: ['seller-user'],
        }),
      );
      expect(notifyFavoriters).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          type: NotificationType.FAVORITE_AVAILABLE_AGAIN,
          data: { productId: 22, productTitle: 'Goku' },
          dedupeKey: 'product:22:availability',
        }),
      );
    });
  });

  describe('forum.reply.created', () => {
    const event = {
      communityProfileId: 9,
      postId: 5,
      replyId: 50,
      authorUserId: 'replier',
      parentReplyId: 40,
    };
    const row = (postAuthor: string, parentAuthor: string | null) => ({
      post_title: 'Post',
      post_author_id: postAuthor,
      community_id: 2,
      community_slug: 'foro',
      parent_author_id: parentAuthor,
      author_username: 'respondona',
    });
    const recipients = () =>
      (notify.mock.calls[0] as [{ userId: string; type: string }[]])[0].map(
        (input) => [input.userId, input.type],
      );

    it('avisa al autor de la respuesta padre y al del post', async () => {
      query.mockResolvedValue([row('post-author', 'parent-author')]);
      await listener.onReplyCreated(event);

      expect(recipients()).toEqual([
        ['parent-author', NotificationType.REPLY_REPLIED],
        ['post-author', NotificationType.POST_REPLIED],
      ]);
    });

    it('si el autor del post es el de la respuesta padre, una sola (reply_replied)', async () => {
      query.mockResolvedValue([row('same', 'same')]);
      await listener.onReplyCreated(event);

      expect(recipients()).toEqual([['same', NotificationType.REPLY_REPLIED]]);
    });

    it('nunca a quien respondió', async () => {
      query.mockResolvedValue([row('replier', 'replier')]);
      await listener.onReplyCreated(event);

      expect(recipients()).toEqual([]);
    });
  });

  describe('autor de la acción', () => {
    it('no avisa una reseña del propio vendedor', async () => {
      await listener.onReviewCreated({
        reviewId: 1,
        productId: 2,
        authorId: 'same',
        sellerUserId: 'same',
        rating: 5,
      });
      expect(query).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it('no avisa una solicitud resuelta por quien la pidió', async () => {
      await listener.onJoinRequestResolved({
        requestId: 1,
        communityId: 2,
        userId: 'same',
        accepted: true,
        resolvedByUserId: 'same',
      });
      expect(notify).not.toHaveBeenCalled();
    });
  });
});
