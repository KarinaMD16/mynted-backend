import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { CosmeticsService } from '../cosmetics/cosmetics.service';
import { UserDisplaySummary } from '../cosmetics/user-display-summary';
import { Product, ProductStatus } from '../products/entities/product.entity';
import {
  ConversationsService,
  isConversationParticipant,
} from './conversations.service';
import { Conversation } from './entities/conversation.entity';
import { MessageType } from './enums/message-type.enum';

describe('ConversationsService', () => {
  const buyerId = 'buyer-1';
  const sellerUserId = 'seller-user-1';
  const createdAt = new Date('2026-10-19T12:00:00Z');

  const conversationRepository = {
    findOne: jest.fn(),
    create: jest.fn((value: Partial<Conversation>) => value),
    save: jest.fn(),
  };
  const productRepository = { findOne: jest.fn() };
  const dataSource = { query: jest.fn() };
  const defaultDisplay = (): UserDisplaySummary => ({
    isPro: false,
    frame: { code: 'frame_default', assetUrl: null },
  });
  // Una entrada por cada id pedido, como el cargador real.
  const cosmeticsService = {
    getEffectiveSummaryForUsers: jest.fn((ids: string[]) =>
      Promise.resolve(new Map(ids.map((id) => [id, defaultDisplay()]))),
    ),
  };
  const service = new ConversationsService(
    conversationRepository as unknown as Repository<Conversation>,
    productRepository as unknown as Repository<Product>,
    dataSource as unknown as DataSource,
    cosmeticsService as unknown as CosmeticsService,
  );

  const product = (status = ProductStatus.ACTIVE, isVisible = true) => ({
    id: 42,
    status,
    isVisible,
    seller: { sellerId: 3, userId: sellerUserId },
  });

  const storedConversation = (id = 15): Conversation =>
    ({
      id,
      buyerId,
      sellerId: sellerUserId,
      productId: 42,
      createdAt,
      lastMessageAt: createdAt,
    }) as Conversation;

  const uniqueViolation = () =>
    new QueryFailedError('INSERT', [], {
      code: '23505',
      constraint: 'UQ_conversation_buyer_id_seller_id_product_id',
    } as unknown as Error);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('hasSellerMessageForProduct', () => {
    it.each([
      ['no conversation', false],
      ['buyer-only messages', false],
      ['wrong buyer, product, or seller', false],
    ])('returns false for %s', async (_scenario, exists) => {
      dataSource.query.mockResolvedValue([{ exists }]);

      await expect(
        service.hasSellerMessageForProduct(buyerId, 42, sellerUserId),
      ).resolves.toBe(false);

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT EXISTS'),
        [buyerId, 42, sellerUserId],
      );
    });

    it('returns true when the seller has sent any message for the product', async () => {
      dataSource.query.mockResolvedValue([{ exists: true }]);

      await expect(
        service.hasSellerMessageForProduct(buyerId, 42, sellerUserId),
      ).resolves.toBe(true);
    });
  });

  describe('findOrCreate', () => {
    it('creates the conversation deriving sellerId from the product owner', async () => {
      productRepository.findOne.mockResolvedValue(product());
      conversationRepository.findOne.mockResolvedValue(null);
      conversationRepository.save.mockResolvedValue(storedConversation());

      const result = await service.findOrCreate(buyerId, 42);

      expect(result.created).toBe(true);
      expect(result.conversation).toEqual({
        id: 15,
        productId: 42,
        buyerId,
        sellerId: sellerUserId,
        createdAt,
        lastMessageAt: createdAt,
      });
      expect(conversationRepository.create).toHaveBeenCalledWith({
        buyerId,
        sellerId: sellerUserId,
        productId: 42,
      });
    });

    it('is idempotent: returns the existing conversation without inserting', async () => {
      productRepository.findOne.mockResolvedValue(product());
      conversationRepository.findOne.mockResolvedValue(storedConversation(7));

      const result = await service.findOrCreate(buyerId, 42);

      expect(result).toEqual({
        conversation: expect.objectContaining({ id: 7 }) as unknown,
        created: false,
      });
      expect(conversationRepository.findOne).toHaveBeenCalledWith({
        where: { buyerId, sellerId: sellerUserId, productId: 42 },
      });
      expect(conversationRepository.save).not.toHaveBeenCalled();
    });

    it('returns the winner when a concurrent request hits the unique constraint', async () => {
      productRepository.findOne.mockResolvedValue(product());
      conversationRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(storedConversation(9));
      conversationRepository.save.mockRejectedValue(uniqueViolation());

      const result = await service.findOrCreate(buyerId, 42);

      expect(result.created).toBe(false);
      expect(result.conversation.id).toBe(9);
    });

    it('rethrows database errors that are not the conversation unique constraint', async () => {
      productRepository.findOne.mockResolvedValue(product());
      conversationRepository.findOne.mockResolvedValue(null);
      const error = new QueryFailedError('INSERT', [], {
        code: '23503',
      } as unknown as Error);
      conversationRepository.save.mockRejectedValue(error);

      await expect(service.findOrCreate(buyerId, 42)).rejects.toBe(error);
    });

    it('rejects self-contact with ForbiddenException', async () => {
      productRepository.findOne.mockResolvedValue(product());

      await expect(service.findOrCreate(sellerUserId, 42)).rejects.toThrow(
        ForbiddenException,
      );
      expect(conversationRepository.findOne).not.toHaveBeenCalled();
      expect(conversationRepository.save).not.toHaveBeenCalled();
    });

    it.each([ProductStatus.DRAFT, ProductStatus.SOLD, ProductStatus.INACTIVE])(
      'rejects a new conversation on a %s product with BadRequestException',
      async (status) => {
        productRepository.findOne.mockResolvedValue(product(status));
        conversationRepository.findOne.mockResolvedValue(null);

        await expect(service.findOrCreate(buyerId, 42)).rejects.toThrow(
          BadRequestException,
        );
        expect(conversationRepository.save).not.toHaveBeenCalled();
      },
    );

    it('rejects a new conversation on a hidden (isVisible = false) product', async () => {
      productRepository.findOne.mockResolvedValue(
        product(ProductStatus.ACTIVE, false),
      );
      conversationRepository.findOne.mockResolvedValue(null);

      await expect(service.findOrCreate(buyerId, 42)).rejects.toThrow(
        BadRequestException,
      );
      expect(conversationRepository.save).not.toHaveBeenCalled();
    });

    it('still returns an existing conversation after the product is hidden', async () => {
      productRepository.findOne.mockResolvedValue(
        product(ProductStatus.ACTIVE, false),
      );
      conversationRepository.findOne.mockResolvedValue(storedConversation(7));

      const result = await service.findOrCreate(buyerId, 42);

      expect(result.created).toBe(false);
      expect(result.conversation.id).toBe(7);
      expect(conversationRepository.save).not.toHaveBeenCalled();
    });

    it('loads isVisible together with status to decide', async () => {
      productRepository.findOne.mockResolvedValue(product());
      conversationRepository.findOne.mockResolvedValue(storedConversation());

      await service.findOrCreate(buyerId, 42);

      expect(productRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            status: true,
            isVisible: true,
          }) as unknown,
        }),
      );
    });

    it('still returns an existing conversation after the product is sold', async () => {
      productRepository.findOne.mockResolvedValue(product(ProductStatus.SOLD));
      conversationRepository.findOne.mockResolvedValue(storedConversation(7));

      const result = await service.findOrCreate(buyerId, 42);

      expect(result.created).toBe(false);
      expect(result.conversation.id).toBe(7);
    });

    it('throws NotFoundException when the product does not exist', async () => {
      productRepository.findOne.mockResolvedValue(null);

      await expect(service.findOrCreate(buyerId, 999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findForParticipant', () => {
    it.each([buyerId, sellerUserId])(
      'returns the conversation to participant %s',
      async (userId) => {
        conversationRepository.findOne.mockResolvedValue(storedConversation());

        await expect(service.findForParticipant(15, userId)).resolves.toEqual(
          storedConversation(),
        );
      },
    );

    it('rejects a non-participant with ForbiddenException', async () => {
      conversationRepository.findOne.mockResolvedValue(storedConversation());

      await expect(
        service.findForParticipant(15, 'intruder-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the conversation does not exist', async () => {
      conversationRepository.findOne.mockResolvedValue(null);

      await expect(service.findForParticipant(999, buyerId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getTotalUnread', () => {
    it("counts the other participants' unread messages in a single query", async () => {
      dataSource.query.mockResolvedValueOnce([{ total: 4 }]);

      await expect(service.getTotalUnread(buyerId)).resolves.toBe(4);

      expect(dataSource.query).toHaveBeenCalledTimes(1);
      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(params).toEqual([buyerId]);
      expect(sql).toMatch(/COUNT\(\*\)/);
      expect(sql).toMatch(/JOIN message m ON m\.conversation_id = c\.id/);
      expect(sql).toMatch(/\(c\.buyer_id = \$1 OR c\.seller_id = \$1\)/);
      expect(sql).toMatch(/m\.sender_id <> \$1/);
      expect(sql).toMatch(/m\.read_at IS NULL/);
    });

    it('returns 0 when the query yields no row', async () => {
      dataSource.query.mockResolvedValueOnce([]);

      await expect(service.getTotalUnread(buyerId)).resolves.toBe(0);
    });
  });

  describe('getInbox', () => {
    const inboxRow = (overrides: Record<string, unknown> = {}) => ({
      id: 15,
      last_message_at: createdAt,
      other_id: sellerUserId,
      other_username: 'karina',
      other_photo_url: 'https://cdn/avatar.png',
      other_display_name: 'Funko Corner CR',
      other_is_verified: true,
      product_id: 42,
      product_title: 'Goku SSJ',
      product_price: '25000.00',
      product_discount_percent: '10.00',
      product_currency: 'CRC',
      product_image_url: 'https://cdn/cover.png',
      last_message_id: 120,
      last_message_type: MessageType.TEXT,
      last_message_content: '¿Sigue disponible?',
      last_message_sender_id: buyerId,
      last_message_created_at: createdAt,
      unread_count: 2,
      ...overrides,
    });

    const sqlOf = (call: number) =>
      (dataSource.query.mock.calls[call] as [string, unknown[]])[0];

    it('maps each row into an inbox item with pagination', async () => {
      dataSource.query
        .mockResolvedValueOnce([inboxRow()])
        .mockResolvedValueOnce([{ total: 21 }]);

      const result = await service.getInbox(buyerId, { page: 2, limit: 20 });

      expect(result.pagination).toEqual({
        page: 2,
        limit: 20,
        total: 21,
        totalPages: 2,
      });
      expect(result.data).toEqual([
        {
          id: 15,
          otherParticipant: {
            id: sellerUserId,
            username: 'karina',
            displayName: 'Funko Corner CR',
            photoUrl: 'https://cdn/avatar.png',
            isVerified: true,
            isPro: false,
            frame: { code: 'frame_default', assetUrl: null },
          },
          product: {
            id: 42,
            title: 'Goku SSJ',
            price: 25000,
            finalPrice: 22500,
            currency: 'CRC',
            imageUrl: 'https://cdn/cover.png',
          },
          lastMessage: {
            id: 120,
            type: MessageType.TEXT,
            content: '¿Sigue disponible?',
            senderId: buyerId,
            createdAt,
          },
          unreadCount: 2,
          lastMessageAt: createdAt,
        },
      ]);
      // userId, limit, offset
      expect(dataSource.query).toHaveBeenNthCalledWith(1, expect.any(String), [
        buyerId,
        20,
        20,
      ]);
    });

    it('filters by EXISTS on message, not by last_message_at, in both queries', async () => {
      dataSource.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 0 }]);

      await service.getInbox(buyerId, { page: 1, limit: 20 });

      for (const sql of [sqlOf(0), sqlOf(1)]) {
        const where = sql.slice(sql.indexOf('(c.buyer_id = $1 OR'));
        expect(where).toMatch(
          /EXISTS \(SELECT 1 FROM message em WHERE em\.conversation_id = c\.id\)/,
        );
        expect(where).not.toMatch(/last_message_at\s*(IS|>|<|=)/);
      }
      expect(sqlOf(0)).toMatch(/ORDER BY c\.last_message_at DESC, c\.id DESC/);
    });

    it('resolves everything in one page query plus one count (no N+1)', async () => {
      dataSource.query
        .mockResolvedValueOnce([inboxRow(), inboxRow({ id: 16 })])
        .mockResolvedValueOnce([{ total: 2 }]);

      await service.getInbox(buyerId, { page: 1, limit: 20 });

      expect(dataSource.query).toHaveBeenCalledTimes(2);
      expect(sqlOf(0)).toMatch(/LEFT JOIN LATERAL/);
      expect(sqlOf(0)).toMatch(
        /um\.sender_id <> \$1\s+AND um\.read_at IS NULL/,
      );
    });

    it('shows an image indicator (type image, no content) as last message', async () => {
      dataSource.query
        .mockResolvedValueOnce([
          inboxRow({
            last_message_type: MessageType.IMAGE,
            last_message_content: null,
          }),
        ])
        .mockResolvedValueOnce([{ total: 1 }]);

      const { data } = await service.getInbox(buyerId, { page: 1, limit: 20 });

      expect(data[0].lastMessage.type).toBe(MessageType.IMAGE);
      expect(data[0].lastMessage.content).toBeNull();
    });

    it('marks isPro and the frame per participant with a single batch for the whole page', async () => {
      cosmeticsService.getEffectiveSummaryForUsers.mockResolvedValueOnce(
        new Map<string, UserDisplaySummary>([
          [sellerUserId, defaultDisplay()],
          [
            'pro-user',
            {
              isPro: true,
              frame: { code: 'frame_gold', assetUrl: 'https://cdn/gold.png' },
            },
          ],
        ]),
      );
      dataSource.query
        .mockResolvedValueOnce([
          inboxRow({ id: 15, other_id: sellerUserId }),
          inboxRow({ id: 16, other_id: 'pro-user' }),
          inboxRow({ id: 17, other_id: 'pro-user' }),
        ])
        .mockResolvedValueOnce([{ total: 3 }]);
      cosmeticsService.getEffectiveSummaryForUsers.mockClear();

      const { data } = await service.getInbox(buyerId, { page: 1, limit: 20 });

      expect(data.map((item) => item.otherParticipant.isPro)).toEqual([
        false,
        true,
        true,
      ]);
      expect(data.map((item) => item.otherParticipant.frame.code)).toEqual([
        'frame_default',
        'frame_gold',
        'frame_gold',
      ]);
      expect(
        cosmeticsService.getEffectiveSummaryForUsers,
      ).toHaveBeenCalledTimes(1);
      expect(cosmeticsService.getEffectiveSummaryForUsers).toHaveBeenCalledWith(
        [sellerUserId, 'pro-user', 'pro-user'],
      );
    });

    it('falls back to username and unverified for a participant without a store', async () => {
      dataSource.query
        .mockResolvedValueOnce([
          inboxRow({ other_display_name: null, other_is_verified: null }),
        ])
        .mockResolvedValueOnce([{ total: 1 }]);

      const { data } = await service.getInbox(sellerUserId, {
        page: 1,
        limit: 20,
      });

      expect(data[0].otherParticipant).toEqual(
        expect.objectContaining({ displayName: 'karina', isVerified: false }),
      );
    });
  });

  it('isConversationParticipant only accepts buyer or seller', () => {
    const conversation = { buyerId: 'a', sellerId: 'b' };

    expect(isConversationParticipant(conversation, 'a')).toBe(true);
    expect(isConversationParticipant(conversation, 'b')).toBe(true);
    expect(isConversationParticipant(conversation, 'c')).toBe(false);
  });
});
