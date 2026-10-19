import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConversationEvents } from './conversation-events';
import { ConversationMessagesController } from './conversation-messages.controller';
import { ConversationsController } from './conversations.controller';
import { ConversationParticipantGuard } from './guards/conversation-participant.guard';

describe('ConversationsController', () => {
  const conversation = {
    id: 15,
    productId: 42,
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    createdAt: new Date(),
    lastMessageAt: new Date(),
  };
  const request = { user: { userId: 'buyer-1' } } as never;

  const buildResponse = () => ({ status: jest.fn() });

  it('protects every route with JwtAuthGuard at class level', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ConversationsController,
    ) as unknown[];

    expect(guards).toContain(JwtAuthGuard);
  });

  it('protects message routes with JwtAuthGuard and ConversationParticipantGuard, in that order', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ConversationMessagesController,
    ) as unknown[];

    expect(guards).toEqual([JwtAuthGuard, ConversationParticipantGuard]);
  });

  it('passes the guarded conversation to the service and returns only the read summary', async () => {
    const readAt = new Date();
    const markAsRead = jest.fn().mockResolvedValue({
      conversationId: 15,
      readerId: 'buyer-1',
      senderId: 'seller-1',
      markedCount: 2,
      messageIds: [1, 2],
      readAt,
    });
    const controller = new ConversationMessagesController({
      markAsRead,
    } as never);
    const guarded = { id: 15, buyerId: 'buyer-1', sellerId: 'seller-1' };

    await expect(
      controller.markAsRead({
        user: { userId: 'buyer-1' },
        conversation: guarded,
      } as never),
    ).resolves.toEqual({ conversationId: 15, markedCount: 2, readAt });
    expect(markAsRead).toHaveBeenCalledWith(guarded, 'buyer-1');
  });

  it('responds 201 when the conversation is created', async () => {
    const findOrCreate = jest
      .fn()
      .mockResolvedValue({ conversation, created: true });
    const controller = new ConversationsController({ findOrCreate } as never);
    const res = buildResponse();

    await expect(
      controller.create({ productId: 42 }, request, res as never),
    ).resolves.toBe(conversation);
    expect(findOrCreate).toHaveBeenCalledWith('buyer-1', 42);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.CREATED);
  });

  it('returns the total unread of the authenticated user', async () => {
    const getTotalUnread = jest.fn().mockResolvedValue(5);
    const controller = new ConversationsController({
      getTotalUnread,
    } as never);

    await expect(controller.getUnreadCount(request)).resolves.toEqual({
      totalUnread: 5,
    });
    expect(getTotalUnread).toHaveBeenCalledWith('buyer-1');
  });

  it('responds 200 when the conversation already existed', async () => {
    const findOrCreate = jest
      .fn()
      .mockResolvedValue({ conversation, created: false });
    const controller = new ConversationsController({ findOrCreate } as never);
    const res = buildResponse();

    await expect(
      controller.create({ productId: 42 }, request, res as never),
    ).resolves.toBe(conversation);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
  });

  describe('domain events for the gateway', () => {
    const guardedRequest = {
      user: { userId: 'buyer-1' },
      conversation: { id: 15, buyerId: 'buyer-1', sellerId: 'seller-1' },
    } as never;
    const created = {
      message: { id: 120, content: 'Hola' },
      conversationId: 15,
      senderId: 'buyer-1',
      recipientId: 'seller-1',
    };

    it('emits MESSAGE_CREATED after persisting a text message', async () => {
      const sendText = jest.fn().mockResolvedValue(created);
      const eventEmitter = { emit: jest.fn() };
      const controller = new ConversationMessagesController(
        { sendText } as never,
        eventEmitter as never,
      );

      await expect(
        controller.sendText({ content: 'Hola' }, guardedRequest),
      ).resolves.toBe(created.message);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ConversationEvents.MESSAGE_CREATED,
        created,
      );
    });

    it('does not emit when persisting fails', async () => {
      const sendImage = jest.fn().mockRejectedValue(new Error('upload'));
      const eventEmitter = { emit: jest.fn() };
      const controller = new ConversationMessagesController(
        { sendImage } as never,
        eventEmitter as never,
      );

      await expect(
        controller.sendImage(undefined, guardedRequest),
      ).rejects.toThrow('upload');
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('emits MESSAGES_READ only when something was marked', async () => {
      const read = {
        conversationId: 15,
        readerId: 'buyer-1',
        senderId: 'seller-1',
        messageIds: [1],
        markedCount: 1,
        readAt: new Date(),
      };
      const markAsRead = jest
        .fn()
        .mockResolvedValueOnce(read)
        .mockResolvedValueOnce({
          ...read,
          messageIds: [],
          markedCount: 0,
          readAt: null,
        });
      const eventEmitter = { emit: jest.fn() };
      const controller = new ConversationMessagesController(
        { markAsRead } as never,
        eventEmitter as never,
      );

      await controller.markAsRead(guardedRequest);
      await controller.markAsRead(guardedRequest);

      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ConversationEvents.MESSAGES_READ,
        read,
      );
    });
  });
});
