import request from 'supertest';
import { User } from '../src/users/entities/user.entity';
import { ChatTestApp, createChatTestApp } from './utils/chat-test-app';

/**
 * GET /conversations/unread-count con base limpia: el vendedor tiene dos
 * conversaciones (con el comprador y con el tercero) sobre el mismo producto.
 */
jest.setTimeout(60_000);

describe('GET /conversations/unread-count (e2e)', () => {
  let ctx: ChatTestApp;
  let buyer: User;
  let seller: User;
  let outsider: User;
  let withBuyer: number;
  let withOutsider: number;

  const http = () => request(ctx.app.getHttpServer());
  const as = (user: User) => ({ Cookie: ctx.cookieFor(user) });

  const unreadOf = async (user: User) => {
    const res = await http()
      .get('/conversations/unread-count')
      .set(as(user))
      .expect(200);
    return (res.body as { totalUnread: number }).totalUnread;
  };
  const send = (user: User, conversationId: number, content: string) =>
    http()
      .post(`/conversations/${conversationId}/messages`)
      .set(as(user))
      .send({ content })
      .expect(201);
  const markRead = (user: User, conversationId: number) =>
    http()
      .patch(`/conversations/${conversationId}/read`)
      .set(as(user))
      .expect(200);

  beforeAll(async () => {
    ctx = await createChatTestApp();
    ({ buyer, seller, outsider } = ctx);
    const open = async (user: User) =>
      (
        (
          await http()
            .post('/conversations')
            .set(as(user))
            .send({ productId: ctx.product.id })
            .expect(201)
        ).body as { id: number }
      ).id;
    withBuyer = await open(buyer);
    withOutsider = await open(outsider);
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('requires authentication', async () => {
    await http().get('/conversations/unread-count').expect(401);
  });

  it('returns 0 for users without messages (open conversations do not count)', async () => {
    for (const user of [buyer, seller, outsider]) {
      await expect(unreadOf(user)).resolves.toBe(0);
    }
  });

  it("adds up the other participants' unread messages across conversations", async () => {
    await send(buyer, withBuyer, 'Hola');
    await send(buyer, withBuyer, '¿Sigue disponible?');
    await send(outsider, withOutsider, 'Me interesa');
    await send(seller, withBuyer, 'Sí, disponible');

    // Vendedor: 2 del comprador + 1 del tercero; sus propios mensajes no
    // cuentan.
    await expect(unreadOf(seller)).resolves.toBe(3);
    await expect(unreadOf(buyer)).resolves.toBe(1);
    await expect(unreadOf(outsider)).resolves.toBe(0);
  });

  it('drops as each conversation is marked as read', async () => {
    await markRead(seller, withBuyer);
    await expect(unreadOf(seller)).resolves.toBe(1);
    // Solo afecta al lector.
    await expect(unreadOf(buyer)).resolves.toBe(1);

    await markRead(seller, withOutsider);
    await expect(unreadOf(seller)).resolves.toBe(0);

    await markRead(buyer, withBuyer);
    await expect(unreadOf(buyer)).resolves.toBe(0);
  });
});
