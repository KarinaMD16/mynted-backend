import { Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { ChatPresence } from '../src/conversations/gateway/chat-presence';
import { User } from '../src/users/entities/user.entity';
import { ChatTestApp, createChatTestApp } from './utils/chat-test-app';

/**
 * Integración del ChatGateway con clientes socket.io reales sobre la app
 * escuchando en un puerto efímero. Los mensajes se crean por HTTP (como el
 * frontend) y se verifica lo que llega por socket.
 */
jest.setTimeout(60_000);

interface Ack {
  ok: boolean;
  conversationId?: number;
  otherParticipant?: { userId: string; online: boolean };
  error?: { status: number; message: string | string[] };
}

interface MessagePayload {
  id: number;
  conversationId: number;
  senderId: string;
  type: string;
  content: string | null;
  imageUrl: string | null;
  createdAt: string;
  readAt: string | null;
}

describe('ChatGateway (e2e)', () => {
  let ctx: ChatTestApp;
  let baseUrl: string;
  let conversationId: number;
  let buyer: User;
  let seller: User;
  let outsider: User;
  const opened: Socket[] = [];

  const http = () => request(ctx.app.getHttpServer());

  const connect = (cookie?: string) =>
    new Promise<Socket>((resolve, reject) => {
      const socket = io(baseUrl, {
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
        extraHeaders: cookie ? { Cookie: cookie } : undefined,
      });
      opened.push(socket);
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  const connectAs = (user: User) => connect(ctx.cookieFor(user));

  const nextEvent = <T>(socket: Socket, event: string, ms = 3000) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timeout esperando ${event}`)),
        ms,
      );
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  const expectNoEvent = (socket: Socket, event: string, ms = 500) =>
    new Promise<void>((resolve, reject) => {
      const handler = (payload: unknown) => {
        clearTimeout(timer);
        reject(
          new Error(`No se esperaba ${event}: ${JSON.stringify(payload)}`),
        );
      };
      const timer = setTimeout(() => {
        socket.off(event, handler);
        resolve();
      }, ms);
      socket.on(event, handler);
    });

  const join = (socket: Socket, id: unknown) =>
    socket
      .timeout(3000)
      .emitWithAck('conversation:join', { conversationId: id }) as Promise<Ack>;

  const sendText = (user: User, content: string) =>
    http()
      .post(`/conversations/${conversationId}/messages`)
      .set({ Cookie: ctx.cookieFor(user) })
      .send({ content })
      .expect(201);

  // Espera a que el servidor procese las desconexiones (la presencia se
  // limpia en handleDisconnect) para que cada test arranque sin nadie online.
  const waitUntilAllOffline = async () => {
    const presence = ctx.app.get(ChatPresence);
    const deadline = Date.now() + 3000;
    while ([buyer, seller, outsider].some((u) => presence.isOnline(u.id))) {
      if (Date.now() > deadline) throw new Error('Quedaron sockets online');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  beforeAll(async () => {
    ctx = await createChatTestApp();
    ({ buyer, seller, outsider } = ctx);
    await ctx.app.listen(0);
    const server = ctx.app.getHttpServer() as unknown as HttpServer;
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;

    const res = await http()
      .post('/conversations')
      .set({ Cookie: ctx.cookieFor(buyer) })
      .send({ productId: ctx.product.id })
      .expect(201);
    conversationId = (res.body as { id: number }).id;
  });

  afterEach(async () => {
    opened.splice(0).forEach((socket) => socket.disconnect());
    await waitUntilAllOffline();
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('rejects connections without a valid session cookie', async () => {
    await expect(connect()).rejects.toThrow('No autenticado');
    await expect(connect('access_token=no-es-un-jwt')).rejects.toThrow(
      'No autenticado',
    );
  });

  it("denies joining someone else's conversation and validates the payload", async () => {
    const intruder = await connectAs(outsider);

    await expect(join(intruder, conversationId)).resolves.toMatchObject({
      ok: false,
      error: { status: 403 },
    });
    await expect(join(intruder, 999999)).resolves.toMatchObject({
      ok: false,
      error: { status: 404 },
    });
    for (const invalid of ['15', -1, 0, 1.5, undefined]) {
      await expect(join(intruder, invalid)).resolves.toMatchObject({
        ok: false,
        error: { status: 400 },
      });
    }

    // No quedó en la sala: un mensaje nuevo no le llega.
    const nothing = expectNoEvent(intruder, 'message:new');
    await sendText(buyer, 'Esto no lo ve el tercero');
    await nothing;
  });

  it('delivers message:new with the full message to the other participant in the room', async () => {
    const buyerSocket = await connectAs(buyer);
    const sellerSocket = await connectAs(seller);
    await expect(join(buyerSocket, conversationId)).resolves.toMatchObject({
      ok: true,
    });
    await expect(join(sellerSocket, conversationId)).resolves.toMatchObject({
      ok: true,
    });

    const received = nextEvent<MessagePayload>(sellerSocket, 'message:new');
    // Ya está en la sala: no debe recibir además el aviso de bandeja.
    const noInbox = expectNoEvent(sellerSocket, 'inbox:message');
    const res = await sendText(buyer, '¿Sigue disponible?');

    const message = await received;
    expect(message).toEqual({
      id: (res.body as { id: number }).id,
      conversationId,
      senderId: buyer.id,
      type: 'text',
      content: '¿Sigue disponible?',
      imageUrl: null,
      createdAt: expect.any(String) as unknown,
      readAt: null,
    });
    await noInbox;
  });

  it('sends inbox:message to the recipient connected outside the room (after leave)', async () => {
    const sellerSocket = await connectAs(seller);
    await join(sellerSocket, conversationId);
    await expect(
      sellerSocket
        .timeout(3000)
        .emitWithAck('conversation:leave', { conversationId }),
    ).resolves.toEqual({ ok: true, conversationId });

    const inbox = nextEvent<MessagePayload>(sellerSocket, 'inbox:message');
    const noRoomEvent = expectNoEvent(sellerSocket, 'message:new');
    await sendText(buyer, 'Te escribo de nuevo');

    await expect(inbox).resolves.toMatchObject({
      conversationId,
      senderId: buyer.id,
      content: 'Te escribo de nuevo',
    });
    await noRoomEvent;
  });

  it('emits message:read to the room after PATCH /read, and nothing when there was nothing to read', async () => {
    const buyerSocket = await connectAs(buyer);
    await join(buyerSocket, conversationId);
    const sent = await sendText(buyer, '¿Me confirmas?');

    const readEvent = nextEvent<{
      conversationId: number;
      readerId: string;
      messageIds: number[];
      readAt: string;
    }>(buyerSocket, 'message:read');
    const res = await http()
      .patch(`/conversations/${conversationId}/read`)
      .set({ Cookie: ctx.cookieFor(seller) })
      .expect(200);

    const payload = await readEvent;
    expect(payload).toMatchObject({ conversationId, readerId: seller.id });
    expect(payload.messageIds).toContain((sent.body as { id: number }).id);
    expect(payload.messageIds).toHaveLength(
      (res.body as { markedCount: number }).markedCount,
    );
    expect(typeof payload.readAt).toBe('string');

    const noRead = expectNoEvent(buyerSocket, 'message:read');
    await http()
      .patch(`/conversations/${conversationId}/read`)
      .set({ Cookie: ctx.cookieFor(seller) })
      .expect(200);
    await noRead;
  });

  it('emits inbox:read to every tab of the reader, including those outside the conversation, and not to the other participant', async () => {
    // Pestaña A con la conversación abierta, pestaña B solo con la bandeja.
    const tabInConversation = await connectAs(seller);
    const tabInInbox = await connectAs(seller);
    const buyerSocket = await connectAs(buyer);
    await join(tabInConversation, conversationId);
    await join(buyerSocket, conversationId);
    await sendText(buyer, '¿Lo apartas?');

    const inInbox = nextEvent<{ conversationId: number; unreadCount: number }>(
      tabInInbox,
      'inbox:read',
    );
    const inConversation = nextEvent<{
      conversationId: number;
      unreadCount: number;
    }>(tabInConversation, 'inbox:read');
    // El comprador recibe message:read por la sala, pero no la bandeja del
    // vendedor.
    const buyerSeesRead = nextEvent(buyerSocket, 'message:read');
    const buyerNoInbox = expectNoEvent(buyerSocket, 'inbox:read');

    await http()
      .patch(`/conversations/${conversationId}/read`)
      .set({ Cookie: ctx.cookieFor(seller) })
      .expect(200);

    // Su única conversación quedó leída: 0 en ella y 0 en total.
    await expect(inInbox).resolves.toEqual({
      conversationId,
      unreadCount: 0,
      totalUnread: 0,
    });
    await expect(inConversation).resolves.toEqual({
      conversationId,
      unreadCount: 0,
      totalUnread: 0,
    });
    await buyerSeesRead;
    await buyerNoInbox;

    // Sin pendientes no cambia nada: no se emite.
    const nothingNew = expectNoEvent(tabInInbox, 'inbox:read');
    await http()
      .patch(`/conversations/${conversationId}/read`)
      .set({ Cookie: ctx.cookieFor(seller) })
      .expect(200);
    await nothingNew;
  });

  it('tracks presence across tabs: online on the first, offline only after the last', async () => {
    const buyerSocket = await connectAs(buyer);
    const outsiderSocket = await connectAs(outsider);
    // El tercero no comparte conversación con el vendedor: no recibe presencia.
    const outsiderQuiet = expectNoEvent(outsiderSocket, 'presence:online', 800);

    const online = nextEvent<{ userId: string }>(
      buyerSocket,
      'presence:online',
    );
    const tab1 = await connectAs(seller);
    await expect(online).resolves.toEqual({ userId: seller.id });

    const noSecondOnline = expectNoEvent(buyerSocket, 'presence:online');
    const tab2 = await connectAs(seller);
    await noSecondOnline;
    await outsiderQuiet;

    await expect(join(buyerSocket, conversationId)).resolves.toEqual({
      ok: true,
      conversationId,
      otherParticipant: { userId: seller.id, online: true },
    });

    const noOfflineYet = expectNoEvent(buyerSocket, 'presence:offline');
    tab1.disconnect();
    await noOfflineYet;

    const offline = nextEvent<{ userId: string }>(
      buyerSocket,
      'presence:offline',
    );
    tab2.disconnect();
    await expect(offline).resolves.toEqual({ userId: seller.id });

    await expect(join(buyerSocket, conversationId)).resolves.toMatchObject({
      otherParticipant: { userId: seller.id, online: false },
    });
  });

  it("inbox:message and inbox:read carry the recipient's totalUnread across conversations", async () => {
    const totalUnreadOf = async (user: User) =>
      (
        (
          await http()
            .get('/conversations/unread-count')
            .set({ Cookie: ctx.cookieFor(user) })
            .expect(200)
        ).body as { totalUnread: number }
      ).totalUnread;
    // Segunda conversación del vendedor, con el tercero.
    const otherConversationId = (
      (
        await http()
          .post('/conversations')
          .set({ Cookie: ctx.cookieFor(outsider) })
          .send({ productId: ctx.product.id })
          .expect(201)
      ).body as { id: number }
    ).id;
    const sellerInbox = await connectAs(seller);
    // Los tests anteriores dejaron todo leído.
    await expect(totalUnreadOf(seller)).resolves.toBe(0);

    let inbox = nextEvent<{ conversationId: number; totalUnread: number }>(
      sellerInbox,
      'inbox:message',
    );
    await sendText(buyer, 'Uno');
    await expect(inbox).resolves.toMatchObject({
      conversationId,
      content: 'Uno',
      totalUnread: 1,
    });

    inbox = nextEvent(sellerInbox, 'inbox:message');
    await http()
      .post(`/conversations/${otherConversationId}/messages`)
      .set({ Cookie: ctx.cookieFor(outsider) })
      .send({ content: 'Dos' })
      .expect(201);
    await expect(inbox).resolves.toMatchObject({
      conversationId: otherConversationId,
      totalUnread: 2,
    });

    // Leer una conversación deja en 0 esa, pero el total conserva la otra.
    const readEvent = nextEvent(sellerInbox, 'inbox:read');
    await http()
      .patch(`/conversations/${conversationId}/read`)
      .set({ Cookie: ctx.cookieFor(seller) })
      .expect(200);
    await expect(readEvent).resolves.toEqual({
      conversationId,
      unreadCount: 0,
      totalUnread: 1,
    });
    await expect(totalUnreadOf(seller)).resolves.toBe(1);
  });
});
