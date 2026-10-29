import {
  BadGatewayException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import {
  ProductStatus,
  ProductType,
} from '../products/entities/product.entity';
import { Seller } from '../sellers/entities/seller.entity';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { MessageType } from './enums/message-type.enum';
import { MessagesService } from './messages.service';
import { PriceDisplayService } from '../pricing/price-display.service';
import { CosmeticsService } from '../cosmetics/cosmetics.service';
import { UserDisplaySummary } from '../cosmetics/user-display-summary';

describe('MessagesService', () => {
  const buyerId = 'buyer-1';
  const sellerUserId = 'seller-1';
  const now = new Date('2026-10-19T12:00:00Z');
  const conversation = {
    id: 15,
    buyerId,
    sellerId: sellerUserId,
    productId: 42,
  } as Conversation;

  // QueryBuilder encadenable: cada método devuelve el mismo objeto.
  const buildQb = (result: { getMany?: unknown; execute?: unknown }) => {
    const qb: Record<string, jest.Mock> = {};
    for (const method of [
      'where',
      'andWhere',
      'orderBy',
      'addOrderBy',
      'limit',
      'update',
      'set',
      'returning',
    ]) {
      qb[method] = jest.fn(() => qb);
    }
    qb.getMany = jest.fn().mockResolvedValue(result.getMany);
    qb.execute = jest.fn().mockResolvedValue(result.execute);
    return qb;
  };

  const message = (id: number, overrides: Partial<Message> = {}) =>
    ({
      id,
      conversationId: 15,
      senderId: buyerId,
      type: MessageType.TEXT,
      content: `msg ${id}`,
      imageUrl: null,
      createdAt: now,
      readAt: null,
      ...overrides,
    }) as Message;

  const createHarness = () => {
    const messageRepository = {
      createQueryBuilder: jest.fn(),
      exists: jest.fn().mockResolvedValue(true),
      count: jest.fn().mockResolvedValue(0),
    };
    const conversationRepository = {
      findOneOrFail: jest.fn().mockResolvedValue({
        ...conversation,
        buyer: { id: buyerId, username: 'comprador', photoUrl: null },
        seller: {
          id: sellerUserId,
          username: 'karina',
          photoUrl: 'https://cdn/a.png',
        },
        product: {
          id: 42,
          title: 'Goku SSJ',
          price: 25000,
          discountPercent: null,
          currency: 'CRC',
          imageUrl: 'https://cdn/cover.png',
          status: ProductStatus.SOLD,
          type: ProductType.SALE,
          isVisible: true,
          deletedAt: null,
        },
      }),
    };
    const sellerRepository = {
      findOne: jest
        .fn()
        .mockResolvedValue({ displayName: 'Funko Corner', isVerified: true }),
    };
    const txMessages = {
      create: jest.fn((value: Partial<Message>) => value),
      save: jest.fn((value: Partial<Message>) =>
        Promise.resolve({ id: 200, createdAt: now, readAt: null, ...value }),
      ),
    };
    const manager = {
      getRepository: jest.fn(() => txMessages),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const dataSource = {
      transaction: jest.fn((callback: (m: typeof manager) => unknown) =>
        callback(manager),
      ),
    };
    const cloudinaryService = {
      uploadImage: jest
        .fn()
        .mockResolvedValue({ url: 'https://res.cloudinary.com/x/a.jpg' }),
    };
    // Precio en la moneda del producto: sin conversión.
    const priceDisplay = {
      getDisplayRates: jest.fn().mockResolvedValue(new Map([['USD', 1]])),
      toDisplay: jest.fn(
        (product: { price: number; currency: string }, target: string) => ({
          displayPrice: product.price,
          displayFinalPrice: product.price,
          displayCurrency: target,
          isConverted: false,
        }),
      ),
    };
    const cosmeticsService = {
      getEffectiveSummaryForUsers: jest.fn((ids: string[]) =>
        Promise.resolve(
          new Map<string, UserDisplaySummary>(
            ids.map((id) => [
              id,
              {
                isPro: false,
                frame: { code: 'frame_default', assetUrl: null },
              },
            ]),
          ),
        ),
      ),
    };
    const service = new MessagesService(
      messageRepository as unknown as Repository<Message>,
      conversationRepository as unknown as Repository<Conversation>,
      sellerRepository as unknown as Repository<Seller>,
      dataSource as unknown as DataSource,
      cloudinaryService as unknown as CloudinaryService,
      priceDisplay as unknown as PriceDisplayService,
      cosmeticsService as unknown as CosmeticsService,
    );
    return {
      service,
      messageRepository,
      sellerRepository,
      txMessages,
      manager,
      dataSource,
      cloudinaryService,
      cosmeticsService,
    };
  };

  const file = {
    originalname: 'foto.png',
    mimetype: 'image/png',
    size: 1024,
    buffer: Buffer.from('png'),
  } as Express.Multer.File;

  describe('sendText', () => {
    it('forces type text, uses the authenticated sender and returns event data', async () => {
      const h = createHarness();

      const result = await h.service.sendText(conversation, buyerId, {
        content: 'Hola',
      });

      expect(h.txMessages.create).toHaveBeenCalledWith({
        conversationId: 15,
        senderId: buyerId,
        type: MessageType.TEXT,
        content: 'Hola',
        imageUrl: null,
      });
      expect(result).toEqual({
        message: expect.objectContaining({
          id: 200,
          type: MessageType.TEXT,
          content: 'Hola',
          senderId: buyerId,
        }) as unknown,
        conversationId: 15,
        senderId: buyerId,
        recipientId: sellerUserId,
      });
    });

    it('inserts and bumps lastMessageAt inside the same transaction', async () => {
      const h = createHarness();

      await h.service.sendText(conversation, sellerUserId, { content: 'Sí' });

      expect(h.dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(h.txMessages.save).toHaveBeenCalled();
      const [entity, criteria, values] = h.manager.update.mock.calls[0] as [
        unknown,
        unknown,
        { lastMessageAt: () => string },
      ];
      expect(entity).toBe(Conversation);
      expect(criteria).toEqual({ id: 15 });
      expect(values.lastMessageAt()).toBe('GREATEST(last_message_at, now())');
    });

    it('does not bump lastMessageAt when the insert fails', async () => {
      const h = createHarness();
      h.txMessages.save.mockRejectedValueOnce(new Error('db down'));

      await expect(
        h.service.sendText(conversation, buyerId, { content: 'Hola' }),
      ).rejects.toThrow('db down');
      expect(h.manager.update).not.toHaveBeenCalled();
    });
  });

  describe('sendImage', () => {
    it('uploads to Cloudinary and creates an image message with that URL and no content', async () => {
      const h = createHarness();

      const result = await h.service.sendImage(
        conversation,
        sellerUserId,
        file,
      );

      expect(h.cloudinaryService.uploadImage).toHaveBeenCalledWith(file);
      expect(h.txMessages.create).toHaveBeenCalledWith({
        conversationId: 15,
        senderId: sellerUserId,
        type: MessageType.IMAGE,
        content: null,
        imageUrl: 'https://res.cloudinary.com/x/a.jpg',
      });
      expect(result.recipientId).toBe(buyerId);
      expect(h.manager.update).toHaveBeenCalled();
    });

    it('requires a file', async () => {
      const h = createHarness();

      await expect(
        h.service.sendImage(conversation, buyerId, undefined),
      ).rejects.toThrow(BadRequestException);
      expect(h.cloudinaryService.uploadImage).not.toHaveBeenCalled();
    });

    it('creates nothing when Cloudinary rejects the image', async () => {
      const h = createHarness();
      h.cloudinaryService.uploadImage.mockRejectedValue(
        new InternalServerErrorException(
          'Cloudinary no devolvió una respuesta válida',
        ),
      );

      await expect(
        h.service.sendImage(conversation, buyerId, file),
      ).rejects.toThrow(InternalServerErrorException);
      expect(h.dataSource.transaction).not.toHaveBeenCalled();
    });

    it('maps unexpected upload errors to a clear 502 and creates nothing', async () => {
      const h = createHarness();
      h.cloudinaryService.uploadImage.mockRejectedValue(
        new Error('ECONNRESET'),
      );

      await expect(
        h.service.sendImage(conversation, buyerId, file),
      ).rejects.toThrow(BadGatewayException);
      expect(h.dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('markAsRead', () => {
    it("marks the other participant's unread messages and returns ids for events", async () => {
      const h = createHarness();
      const qb = buildQb({
        execute: {
          raw: [
            { id: 120, read_at: now },
            { id: 121, read_at: now },
          ],
          affected: 2,
        },
      });
      h.messageRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await h.service.markAsRead(conversation, buyerId);

      expect(result).toEqual({
        conversationId: 15,
        readerId: buyerId,
        senderId: sellerUserId,
        markedCount: 2,
        messageIds: [120, 121],
        readAt: now,
        unreadCount: 0,
      });
      expect(h.messageRepository.count).toHaveBeenCalledWith({
        where: {
          conversationId: 15,
          senderId: Not(buyerId),
          readAt: IsNull(),
        },
      });
      const [values] = qb.set.mock.calls[0] as [{ readAt: () => string }];
      expect(values.readAt()).toBe('now()');
      expect(qb.andWhere).toHaveBeenCalledWith('sender_id <> :readerId', {
        readerId: buyerId,
      });
      expect(qb.andWhere).toHaveBeenCalledWith('read_at IS NULL');
    });

    it('is idempotent: with nothing pending it returns 0', async () => {
      const h = createHarness();
      h.messageRepository.createQueryBuilder.mockReturnValue(
        buildQb({ execute: { raw: [], affected: 0 } }),
      );

      const result = await h.service.markAsRead(conversation, buyerId);

      expect(result.markedCount).toBe(0);
      expect(result.messageIds).toEqual([]);
      expect(result.readAt).toBeNull();
      expect(result.unreadCount).toBe(0);
      expect(h.messageRepository.count).not.toHaveBeenCalled();
    });

    it('reports a message that arrived right after marking as still unread', async () => {
      const h = createHarness();
      h.messageRepository.createQueryBuilder.mockReturnValue(
        buildQb({ execute: { raw: [{ id: 120, read_at: now }], affected: 1 } }),
      );
      h.messageRepository.count.mockResolvedValue(1);

      const result = await h.service.markAsRead(conversation, buyerId);

      expect(result.markedCount).toBe(1);
      expect(result.unreadCount).toBe(1);
    });
  });

  describe('getHistory', () => {
    it('returns newest first with nextCursor when there are more pages', async () => {
      const h = createHarness();
      const qb = buildQb({ getMany: [message(30), message(29), message(28)] });
      h.messageRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await h.service.getHistory(
        conversation,
        buyerId,
        { limit: 2 },
        'CRC',
      );

      expect(result.data.map((m) => m.id)).toEqual([30, 29]);
      expect(result.nextCursor).toBe(29);
      expect(qb.orderBy).toHaveBeenCalledWith('m.createdAt', 'DESC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('m.id', 'DESC');
      expect(qb.limit).toHaveBeenCalledWith(3);
    });

    it('returns nextCursor null on the last page and applies the cursor', async () => {
      const h = createHarness();
      const qb = buildQb({ getMany: [message(28)] });
      h.messageRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await h.service.getHistory(
        conversation,
        buyerId,
        { cursor: 29, limit: 2 },
        'CRC',
      );

      expect(result.nextCursor).toBeNull();
      expect(h.messageRepository.exists).toHaveBeenCalledWith({
        where: { id: 29, conversationId: 15 },
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('(m.created_at, m.id) <'),
        { cursor: 29 },
      );
    });

    it('rejects a cursor from another conversation', async () => {
      const h = createHarness();
      h.messageRepository.exists.mockResolvedValue(false);

      await expect(
        h.service.getHistory(
          conversation,
          buyerId,
          { cursor: 999, limit: 2 },
          'CRC',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(h.messageRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('marks the other participant as Pro with their frame when the subscription is current', async () => {
      const h = createHarness();
      h.cosmeticsService.getEffectiveSummaryForUsers.mockResolvedValue(
        new Map<string, UserDisplaySummary>([
          [
            sellerUserId,
            {
              isPro: true,
              frame: { code: 'frame_gold', assetUrl: 'https://cdn/gold.png' },
            },
          ],
        ]),
      );
      h.messageRepository.createQueryBuilder.mockReturnValue(
        buildQb({ getMany: [] }),
      );

      const result = await h.service.getHistory(
        conversation,
        buyerId,
        { limit: 30 },
        'CRC',
      );

      expect(
        h.cosmeticsService.getEffectiveSummaryForUsers,
      ).toHaveBeenCalledWith([sellerUserId]);
      expect(result.conversation.otherParticipant).toMatchObject({
        isPro: true,
        frame: { code: 'frame_gold', assetUrl: 'https://cdn/gold.png' },
      });
    });

    it('includes product context (still readable when sold) and the other participant', async () => {
      const h = createHarness();
      h.messageRepository.createQueryBuilder.mockReturnValue(
        buildQb({ getMany: [] }),
      );

      const result = await h.service.getHistory(
        conversation,
        buyerId,
        { limit: 30 },
        'CRC',
      );

      expect(result.conversation).toEqual({
        id: 15,
        viewerRole: 'buyer',
        sellerHasReplied: true,
        productType: ProductType.SALE,
        product: {
          id: 42,
          title: 'Goku SSJ',
          price: 25000,
          finalPrice: 25000,
          currency: 'CRC',
          imageUrl: 'https://cdn/cover.png',
          status: ProductStatus.SOLD,
          isAvailable: false,
          displayPrice: 25000,
          displayFinalPrice: 25000,
          displayCurrency: 'CRC',
          isConverted: false,
        },
        otherParticipant: {
          id: sellerUserId,
          username: 'karina',
          displayName: 'Funko Corner',
          photoUrl: 'https://cdn/a.png',
          isVerified: true,
          isPro: false,
          frame: { code: 'frame_default', assetUrl: null },
        },
      });
      expect(h.sellerRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: sellerUserId } }),
      );
    });
  });
});
