import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import {
  Product,
  ProductStatus,
} from '../src/products/entities/product.entity';
import { User } from '../src/users/entities/user.entity';
import {
  CLOUDINARY_URL,
  ChatTestApp,
  createChatTestApp,
} from './utils/chat-test-app';

/**
 * Flujo HTTP completo del chat con dos usuarios (más un tercero para los
 * casos de acceso), sobre la base e2e (ver e2e-env.ts). Cloudinary es un
 * fake: no se sube nada real.
 */
jest.setTimeout(60_000);

interface MessageBody {
  id: number;
  type: string;
  content: string | null;
  imageUrl: string | null;
  senderId: string;
  readAt: string | null;
}

interface InboxBody {
  data: {
    id: number;
    otherParticipant: {
      id: string;
      username: string;
      displayName: string;
      isVerified: boolean;
    };
    product: { id: number; title: string; price: number; finalPrice: number };
    lastMessage: { type: string; content: string | null; senderId: string };
    unreadCount: number;
  }[];
  pagination: { page: number; limit: number; total: number };
}

interface HistoryBody {
  conversation: {
    id: number;
    product: { id: number; status: string; isAvailable: boolean };
    otherParticipant: { id: string; displayName: string };
  };
  data: MessageBody[];
  nextCursor: number | null;
}

describe('Conversations (e2e)', () => {
  let ctx: ChatTestApp;
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let cloudinary: ChatTestApp['cloudinary'];
  let buyer: User;
  let seller: User;
  let outsider: User;
  let product: Product;

  const http = () => request(app.getHttpServer());
  const as = (user: User) => ({ Cookie: ctx.cookieFor(user) });

  // Estado compartido entre los pasos del flujo (corren en orden).
  let conversationId: number;
  let outsiderConversationId: number;
  let textMessageId: number;
  let imageMessageId: number;

  beforeAll(async () => {
    ctx = await createChatTestApp();
    ({ app, dataSource, cloudinary, buyer, seller, outsider, product } = ctx);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    cloudinary.uploadImage.mockReset();
    cloudinary.uploadImage.mockResolvedValue({ url: CLOUDINARY_URL });
  });

  it('requires authentication', async () => {
    await http().get('/conversations').expect(401);
  });

  it('answers 400 (not 500) to ids outside the int range', async () => {
    const tooBig = 2147483648;
    await http()
      .post('/conversations')
      .set(as(buyer))
      .send({ productId: tooBig })
      .expect(400);
    await http()
      .get(`/conversations/${tooBig}/messages`)
      .set(as(buyer))
      .expect(400);
    await http()
      .patch(`/conversations/${tooBig}/read`)
      .set(as(buyer))
      .expect(400);
  });

  it('buyer opens a conversation (201) and reopening it is idempotent (200)', async () => {
    const created = await http()
      .post('/conversations')
      .set(as(buyer))
      .send({ productId: product.id })
      .expect(201);
    conversationId = (created.body as { id: number }).id;
    expect(created.body).toMatchObject({
      productId: product.id,
      buyerId: buyer.id,
      sellerId: seller.id,
    });

    const reopened = await http()
      .post('/conversations')
      .set(as(buyer))
      .send({ productId: product.id })
      .expect(200);
    expect((reopened.body as { id: number }).id).toBe(conversationId);

    await http()
      .post('/conversations')
      .set(as(seller))
      .send({ productId: product.id })
      .expect(403);
  });

  it('a conversation without messages does not show up in any inbox', async () => {
    const res = await http()
      .post('/conversations')
      .set(as(outsider))
      .send({ productId: product.id })
      .expect(201);
    outsiderConversationId = (res.body as { id: number }).id;

    for (const user of [buyer, seller, outsider]) {
      const inbox = await http()
        .get('/conversations')
        .set(as(user))
        .expect(200);
      expect((inbox.body as InboxBody).pagination.total).toBe(0);
      expect((inbox.body as InboxBody).data).toEqual([]);
    }
  });

  it('buyer sends a text message; the body only accepts content', async () => {
    const res = await http()
      .post(`/conversations/${conversationId}/messages`)
      .set(as(buyer))
      .send({ content: '  Hola, ¿sigue disponible?  ' })
      .expect(201);
    const message = res.body as MessageBody;
    textMessageId = message.id;
    expect(message).toMatchObject({
      type: 'text',
      content: 'Hola, ¿sigue disponible?',
      imageUrl: null,
      senderId: buyer.id,
      readAt: null,
    });

    await http()
      .post(`/conversations/${conversationId}/messages`)
      .set(as(buyer))
      .send({ content: 'x', type: 'image' })
      .expect(400);
    await http()
      .post(`/conversations/${conversationId}/messages`)
      .set(as(buyer))
      .send({ content: '   ' })
      .expect(400);
    await http()
      .post(`/conversations/${conversationId}/messages`)
      .set(as(outsider))
      .send({ content: 'Me cuelo' })
      .expect(403);
  });

  it('seller sends an image that goes through CloudinaryService', async () => {
    const res = await http()
      .post(`/conversations/${conversationId}/messages/image`)
      .set(as(seller))
      .attach('image', Buffer.from('fake-png'), {
        filename: 'foto.png',
        contentType: 'image/png',
      })
      .expect(201);
    const message = res.body as MessageBody;
    imageMessageId = message.id;
    expect(message).toMatchObject({
      type: 'image',
      content: null,
      imageUrl: CLOUDINARY_URL,
      senderId: seller.id,
    });
    expect(cloudinary.uploadImage).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid image uploads without creating messages', async () => {
    const url = `/conversations/${conversationId}/messages/image`;

    const gif = await http()
      .post(url)
      .set(as(seller))
      .attach('image', Buffer.from('gif'), {
        filename: 'a.gif',
        contentType: 'image/gif',
      })
      .expect(400);
    expect((gif.body as { message: string }).message).toContain('JPG');

    const withCaption = await http()
      .post(url)
      .set(as(seller))
      .field('caption', 'mira')
      .attach('image', Buffer.from('png'), {
        filename: 'a.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect((withCaption.body as { message: string }).message).toContain(
      'sin campos de texto',
    );

    await http()
      .post(url)
      .set(as(seller))
      .attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), {
        filename: 'big.png',
        contentType: 'image/png',
      })
      .expect(413);

    await http().post(url).set(as(seller)).expect(400);

    await http()
      .post(url)
      .set(as(outsider))
      .attach('image', Buffer.from('png'), {
        filename: 'a.png',
        contentType: 'image/png',
      })
      .expect(403);

    cloudinary.uploadImage.mockRejectedValueOnce(new Error('ECONNRESET'));
    await http()
      .post(url)
      .set(as(seller))
      .attach('image', Buffer.from('png'), {
        filename: 'a.png',
        contentType: 'image/png',
      })
      .expect(502);

    // Solo el texto del comprador y la imagen válida del vendedor.
    const messageCount = await dataSource.query<{ n: number }[]>(
      'SELECT COUNT(*)::int AS n FROM message WHERE conversation_id = $1',
      [conversationId],
    );
    expect(messageCount[0].n).toBe(2);
  });

  it('lists the inbox with participant, product, last message and unread count', async () => {
    const sellerInbox = (
      await http().get('/conversations').set(as(seller)).expect(200)
    ).body as InboxBody;
    // La conversación vacía del tercero no aparece.
    expect(sellerInbox.pagination).toMatchObject({ page: 1, total: 1 });
    expect(sellerInbox.data[0]).toMatchObject({
      id: conversationId,
      otherParticipant: {
        id: buyer.id,
        displayName: 'comprador',
        isVerified: false,
      },
      product: {
        id: product.id,
        title: 'Funko Pop Goku SSJ',
        price: 25000,
        finalPrice: 22500,
      },
      lastMessage: { type: 'image', content: null, senderId: seller.id },
      unreadCount: 1,
    });

    const buyerInbox = (
      await http().get('/conversations').set(as(buyer)).expect(200)
    ).body as InboxBody;
    expect(buyerInbox.data[0]).toMatchObject({
      otherParticipant: {
        id: seller.id,
        displayName: 'Funko Corner CR',
        isVerified: true,
      },
      unreadCount: 1,
    });
  });

  it('reads the history newest first with cursor pagination and context', async () => {
    const url = `/conversations/${conversationId}/messages`;

    const first = (
      await http().get(url).query({ limit: 1 }).set(as(buyer)).expect(200)
    ).body as HistoryBody;
    expect(first.data.map((m) => m.id)).toEqual([imageMessageId]);
    expect(first.nextCursor).toBe(imageMessageId);
    expect(first.conversation).toMatchObject({
      id: conversationId,
      product: { id: product.id, status: 'active', isAvailable: true },
      otherParticipant: { id: seller.id, displayName: 'Funko Corner CR' },
    });

    const second = (
      await http()
        .get(url)
        .query({ limit: 1, cursor: first.nextCursor })
        .set(as(buyer))
        .expect(200)
    ).body as HistoryBody;
    expect(second.data.map((m) => m.id)).toEqual([textMessageId]);
    expect(second.nextCursor).toBeNull();

    await http().get(url).set(as(outsider)).expect(403);
    await http().get(url).query({ cursor: 999999 }).set(as(buyer)).expect(400);
    await http()
      .get(url)
      .query({ cursor: 2147483648 })
      .set(as(buyer))
      .expect(400);
    await http()
      .get('/conversations/999999/messages')
      .set(as(buyer))
      .expect(404);
  });

  it('marks messages as read idempotently', async () => {
    const url = `/conversations/${conversationId}/read`;

    const firstRead = await http().patch(url).set(as(buyer)).expect(200);
    expect(firstRead.body).toMatchObject({
      conversationId,
      markedCount: 1,
    });
    expect((firstRead.body as { readAt: string | null }).readAt).not.toBeNull();

    const again = await http().patch(url).set(as(buyer)).expect(200);
    expect(again.body).toMatchObject({ markedCount: 0, readAt: null });

    const buyerInbox = (
      await http().get('/conversations').set(as(buyer)).expect(200)
    ).body as InboxBody;
    expect(buyerInbox.data[0].unreadCount).toBe(0);
    // El vendedor no ha leído: su contador no cambia.
    const sellerInbox = (
      await http().get('/conversations').set(as(seller)).expect(200)
    ).body as InboxBody;
    expect(sellerInbox.data[0].unreadCount).toBe(1);

    const history = (
      await http()
        .get(`/conversations/${conversationId}/messages`)
        .set(as(buyer))
        .expect(200)
    ).body as HistoryBody;
    const image = history.data.find((m) => m.id === imageMessageId);
    const text = history.data.find((m) => m.id === textMessageId);
    expect(image?.readAt).not.toBeNull();
    expect(text?.readAt).toBeNull();

    await http().patch(url).set(as(outsider)).expect(403);
  });

  it('existing threads stay readable and writable after the product is sold and hidden', async () => {
    await dataSource
      .getRepository(Product)
      .update(product.id, { status: ProductStatus.SOLD, isVisible: false });

    await http()
      .post(`/conversations/${conversationId}/messages`)
      .set(as(buyer))
      .send({ content: '¿Lo vendiste?' })
      .expect(201);
    // Reabrir la conversación existente sigue devolviendo 200.
    await http()
      .post('/conversations')
      .set(as(buyer))
      .send({ productId: product.id })
      .expect(200);

    const history = (
      await http()
        .get(`/conversations/${conversationId}/messages`)
        .set(as(buyer))
        .expect(200)
    ).body as HistoryBody;
    expect(history.conversation.product).toMatchObject({
      status: 'sold',
      isAvailable: false,
    });

    // La conversación del tercero (antes vacía) entra a la bandeja al recibir
    // su primer mensaje y, por ser la más reciente, queda primera.
    await http()
      .post(`/conversations/${outsiderConversationId}/messages`)
      .set(as(outsider))
      .send({ content: 'Llegué tarde' })
      .expect(201);
    const sellerInbox = (
      await http().get('/conversations').set(as(seller)).expect(200)
    ).body as InboxBody;
    expect(sellerInbox.data.map((item) => item.id)).toEqual([
      outsiderConversationId,
      conversationId,
    ]);
  });
});
