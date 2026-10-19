import { ForbiddenException } from '@nestjs/common';
import { WsJwtAuthenticator } from '../../auth/ws-jwt-authenticator';
import { ConversationsService } from '../conversations.service';
import { MessageType } from '../enums/message-type.enum';
import { ChatGateway } from './chat.gateway';
import { ChatPresence } from './chat-presence';

describe('ChatGateway', () => {
  const conversation = { id: 15, buyerId: 'buyer', sellerId: 'seller' };

  const createHarness = () => {
    const emitted: {
      rooms: unknown;
      except?: string;
      event: string;
      payload: unknown;
    }[] = [];
    const server = {
      to: jest.fn((rooms: unknown) => ({
        emit: (event: string, payload: unknown) =>
          emitted.push({ rooms, event, payload }),
        except: (except: string) => ({
          emit: (event: string, payload: unknown) =>
            emitted.push({ rooms, except, event, payload }),
        }),
      })),
    };
    const conversationsService = {
      findForParticipant: jest.fn().mockResolvedValue(conversation),
      findCounterpartIds: jest.fn().mockResolvedValue(['seller', 'other']),
      getTotalUnread: jest.fn().mockResolvedValue(7),
    };
    const presence = new ChatPresence();
    const gateway = new ChatGateway(
      {} as WsJwtAuthenticator,
      conversationsService as unknown as ConversationsService,
      presence,
    );
    Object.assign(gateway, { server });
    const socket = (userId: string, id = `${userId}-tab`) => ({
      id,
      data: { userId },
      join: jest.fn(),
      leave: jest.fn(),
    });
    return { gateway, emitted, conversationsService, presence, socket };
  };

  const message = {
    id: 120,
    conversationId: 15,
    senderId: 'buyer',
    type: MessageType.TEXT,
    content: 'Hola',
    imageUrl: null,
    createdAt: new Date(),
    readAt: null,
  };

  const created = {
    message,
    conversationId: 15,
    senderId: 'buyer',
    recipientId: 'seller',
  };

  const read = (readAt: Date) => ({
    conversationId: 15,
    readerId: 'seller',
    senderId: 'buyer',
    markedCount: 2,
    messageIds: [1, 2],
    readAt,
    unreadCount: 0,
  });

  it("emits message:new to the room and inbox:message with the recipient's totalUnread outside it", async () => {
    const { gateway, emitted, presence, conversationsService } =
      createHarness();
    presence.connect('seller', 's1');

    await gateway.onMessageCreated(created);

    expect(conversationsService.getTotalUnread).toHaveBeenCalledWith('seller');
    expect(emitted).toEqual([
      { rooms: 'conversation:15', event: 'message:new', payload: message },
      {
        rooms: 'user:seller',
        except: 'conversation:15',
        event: 'inbox:message',
        payload: { ...message, totalUnread: 7 },
      },
    ]);
  });

  it("emits message:read to the room and inbox:read with the reader's totals", async () => {
    const { gateway, emitted, presence, conversationsService } =
      createHarness();
    presence.connect('seller', 's1');
    const readAt = new Date();

    await gateway.onMessagesRead(read(readAt));

    expect(conversationsService.getTotalUnread).toHaveBeenCalledWith('seller');
    expect(emitted).toEqual([
      {
        rooms: 'conversation:15',
        event: 'message:read',
        payload: {
          conversationId: 15,
          readerId: 'seller',
          messageIds: [1, 2],
          readAt,
        },
      },
      {
        rooms: 'user:seller',
        event: 'inbox:read',
        payload: { conversationId: 15, unreadCount: 0, totalUnread: 7 },
      },
    ]);
  });

  it('skips the totalUnread query and inbox events when the user has no sockets', async () => {
    const { gateway, emitted, conversationsService } = createHarness();

    await gateway.onMessageCreated(created);
    await gateway.onMessagesRead(read(new Date()));

    expect(conversationsService.getTotalUnread).not.toHaveBeenCalled();
    expect(emitted.map((e) => e.event)).toEqual([
      'message:new',
      'message:read',
    ]);
  });

  it('still emits message:new and message:read if counting fails', async () => {
    const { gateway, emitted, presence, conversationsService } =
      createHarness();
    presence.connect('seller', 's1');
    conversationsService.getTotalUnread.mockRejectedValue(new Error('db'));
    jest.spyOn(gateway['logger'], 'error').mockImplementation(() => undefined);

    await gateway.onMessageCreated(created);
    await gateway.onMessagesRead(read(new Date()));

    expect(emitted.map((e) => e.event)).toEqual([
      'message:new',
      'message:read',
    ]);
  });

  it('joins the room only after checking participation and reports presence', async () => {
    const { gateway, conversationsService, presence, socket } = createHarness();
    presence.connect('seller', 's1');
    const buyerSocket = socket('buyer');

    await expect(
      gateway.join(buyerSocket as never, { conversationId: 15 }),
    ).resolves.toEqual({
      ok: true,
      conversationId: 15,
      otherParticipant: { userId: 'seller', online: true },
    });
    expect(conversationsService.findForParticipant).toHaveBeenCalledWith(
      15,
      'buyer',
    );
    expect(buyerSocket.join).toHaveBeenCalledWith('conversation:15');
  });

  it('does not join when the user is not a participant', async () => {
    const { gateway, conversationsService, socket } = createHarness();
    conversationsService.findForParticipant.mockRejectedValue(
      new ForbiddenException(),
    );
    const intruder = socket('intruder');

    await expect(
      gateway.join(intruder as never, { conversationId: 15 }),
    ).rejects.toThrow(ForbiddenException);
    expect(intruder.join).not.toHaveBeenCalled();
  });

  it('announces presence to counterparts only on the first and last socket', async () => {
    const { gateway, emitted, socket } = createHarness();
    const tab1 = socket('buyer', 't1');
    const tab2 = socket('buyer', 't2');

    await gateway.handleConnection(tab1 as never);
    await gateway.handleConnection(tab2 as never);
    expect(tab1.join).toHaveBeenCalledWith('user:buyer');
    expect(emitted).toEqual([
      {
        rooms: ['user:seller', 'user:other'],
        event: 'presence:online',
        payload: { userId: 'buyer' },
      },
    ]);

    await gateway.handleDisconnect(tab1 as never);
    expect(emitted).toHaveLength(1);
    await gateway.handleDisconnect(tab2 as never);
    expect(emitted[1]).toEqual({
      rooms: ['user:seller', 'user:other'],
      event: 'presence:offline',
      payload: { userId: 'buyer' },
    });
  });
});
