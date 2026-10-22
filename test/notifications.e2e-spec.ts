import request from 'supertest';
import { Notification } from '../src/notifications/entities/notification.entity';
import { NotificationType } from '../src/notifications/enums/notification-type.enum';
import {
  NotificationNewPayload,
  NotificationSocketEvents,
  UnreadCountPayload,
} from '../src/notifications/notifications.gateway';
import { NotificationsService } from '../src/notifications/notifications.service';
import { User } from '../src/users/entities/user.entity';
import {
  createNotificationsTestApp,
  NotificationsTestApp,
} from './utils/notifications-test-app';

/**
 * Núcleo de notificaciones contra Postgres real: REST, unificación por
 * dedupe_key (índice único parcial + ON CONFLICT) y emisión por socket.
 */
jest.setTimeout(60_000);

describe('Notificaciones (e2e)', () => {
  let ctx: NotificationsTestApp;
  let service: NotificationsService;
  let ana: User;
  let beto: User;
  let inactive: User;

  const http = () => request(ctx.app.getHttpServer());
  const as = (user: User) => ({ Cookie: ctx.cookieFor(user) });
  const notifyAna = (
    title: string,
    extra: { dedupeKey?: string; data?: Record<string, unknown> } = {},
  ) =>
    service.notify([
      {
        userId: ana.id,
        type: NotificationType.REVIEW_RECEIVED,
        data: { productTitle: title, ...extra.data },
        message: `Reseña en ${title}`,
        dedupeKey: extra.dedupeKey,
      },
    ]);

  beforeAll(async () => {
    ctx = await createNotificationsTestApp();
    service = ctx.app.get(NotificationsService);
    const users = ctx.repo(User);
    [ana, beto, inactive] = await users.save([
      users.create({ email: 'ana@e2e.test', username: 'ana' }),
      users.create({ email: 'beto@e2e.test', username: 'beto' }),
      users.create({
        email: 'off@e2e.test',
        username: 'off',
        isActive: false,
      }),
    ]);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await ctx.repo(Notification).clear();
  });

  describe('REST', () => {
    it('exige sesión', async () => {
      await http().get('/notifications').expect(401);
      await http().get('/notifications/unread-count').expect(401);
    });

    it('lista solo las propias, de la más reciente a la más antigua, con paginación y filtro unread', async () => {
      await notifyAna('uno');
      await notifyAna('dos');
      await notifyAna('tres');
      await service.notify([
        {
          userId: beto.id,
          type: NotificationType.BADGE_AWARDED,
          data: {},
          message: 'de beto',
        },
      ]);

      const page1 = await http()
        .get('/notifications?page=1&limit=2')
        .set(as(ana))
        .expect(200);
      const body = page1.body as {
        data: { data: { productTitle: string }; message: string }[];
        pagination: unknown;
      };
      expect(body.data.map((n) => n.data.productTitle)).toEqual([
        'tres',
        'dos',
      ]);
      expect(body.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(body.data[0]).not.toHaveProperty('userId');
      expect(body.data[0]).not.toHaveProperty('dedupeKey');

      await http().get('/notifications?unread=maybe').set(as(ana)).expect(400);
    });

    it('marca como leída, cuenta no leídas y filtra unread', async () => {
      const [first] = await notifyAna('uno');
      await notifyAna('dos');

      await expect(
        http().get('/notifications/unread-count').set(as(ana)),
      ).resolves.toMatchObject({ body: { unreadCount: 2 } });

      const read = await http()
        .patch(`/notifications/${first.id}/read`)
        .set(as(ana))
        .expect(200);
      expect((read.body as { readAt: string | null }).readAt).not.toBeNull();

      const unread = await http()
        .get('/notifications?unread=true')
        .set(as(ana))
        .expect(200);
      expect((unread.body as { data: unknown[] }).data).toHaveLength(1);

      const all = await http()
        .patch('/notifications/read-all')
        .set(as(ana))
        .expect(200);
      expect(all.body).toEqual({ updated: 1, unreadCount: 0 });
    });

    it('no deja leer ni borrar las de otro usuario (404)', async () => {
      const [mine] = await notifyAna('privada');

      await http()
        .patch(`/notifications/${mine.id}/read`)
        .set(as(beto))
        .expect(404);
      await http()
        .delete(`/notifications/${mine.id}`)
        .set(as(beto))
        .expect(404);
      await http()
        .patch('/notifications/no-es-uuid/read')
        .set(as(ana))
        .expect(400);

      await http().delete(`/notifications/${mine.id}`).set(as(ana)).expect(204);
      await http().delete(`/notifications/${mine.id}`).set(as(ana)).expect(404);
    });
  });

  describe('creación', () => {
    it('descarta las de cuentas desactivadas', async () => {
      const created = await service.notify([
        {
          userId: inactive.id,
          type: NotificationType.BADGE_AWARDED,
          data: {},
          message: 'x',
        },
        {
          userId: beto.id,
          type: NotificationType.BADGE_AWARDED,
          data: {},
          message: 'y',
        },
      ]);

      expect(created).toHaveLength(1);
      expect(await ctx.repo(Notification).count()).toBe(1);
    });

    it('unifica por dedupe_key: actualiza la no leída, conserva las claves pedidas y vuelve arriba', async () => {
      const key = 'product:7:price';
      const [first] = await service.notify([
        {
          userId: ana.id,
          type: NotificationType.FAVORITE_PRICE_CHANGED,
          data: { productId: 7, previousPrice: 100, newPrice: 90 },
          message: 'a',
          dedupeKey: key,
        },
      ]);
      await notifyAna('otra');

      const [merged] = await service.notify(
        [
          {
            userId: ana.id,
            type: NotificationType.FAVORITE_PRICE_CHANGED,
            data: { productId: 7, previousPrice: 90, newPrice: 80 },
            message: 'b',
            dedupeKey: key,
          },
        ],
        { preserveKeys: ['previousPrice'] },
      );

      expect(merged.id).toBe(first.id);
      expect(merged.data).toEqual({
        productId: 7,
        previousPrice: 100,
        newPrice: 80,
      });
      expect(merged.message).toBe('b');
      expect(await ctx.repo(Notification).count()).toBe(2);

      // Volvió arriba del listado.
      const list = await http().get('/notifications').set(as(ana)).expect(200);
      expect((list.body as { data: { id: string }[] }).data[0].id).toBe(
        first.id,
      );

      // Una vez leída, el siguiente cambio crea una nueva.
      await service.markRead(ana.id, first.id);
      const [fresh] = await service.notify([
        {
          userId: ana.id,
          type: NotificationType.FAVORITE_PRICE_CHANGED,
          data: { productId: 7, previousPrice: 80, newPrice: 70 },
          message: 'c',
          dedupeKey: key,
        },
      ]);
      expect(fresh.id).not.toBe(first.id);
    });

    it('sin dedupe_key nunca unifica', async () => {
      await notifyAna('igual');
      await notifyAna('igual');

      expect(await ctx.repo(Notification).count()).toBe(2);
    });
  });

  describe('socket', () => {
    it('emite notification:new con el contador a todas las pestañas del usuario y a nadie más', async () => {
      const tab1 = await ctx.connect(ana);
      const tab2 = await ctx.connect(ana);
      const other = await ctx.connect(beto);
      let otherReceived = false;
      other.on(NotificationSocketEvents.NEW, () => {
        otherReceived = true;
      });

      const received = Promise.all([
        ctx.next<NotificationNewPayload>(tab1, NotificationSocketEvents.NEW),
        ctx.next<NotificationNewPayload>(tab2, NotificationSocketEvents.NEW),
      ]);
      await notifyAna('en vivo');

      const [payload1, payload2] = await received;
      expect(payload1).toEqual(payload2);
      expect(payload1).toMatchObject({
        unreadCount: 1,
        notification: {
          type: NotificationType.REVIEW_RECEIVED,
          data: { productTitle: 'en vivo' },
          readAt: null,
        },
      });
      expect(otherReceived).toBe(false);
    });

    it('sincroniza el contador al leer', async () => {
      const [created] = await notifyAna('leer');
      const tab = await ctx.connect(ana);

      const count = ctx.next<UnreadCountPayload>(
        tab,
        NotificationSocketEvents.UNREAD_COUNT,
      );
      await http()
        .patch(`/notifications/${created.id}/read`)
        .set(as(ana))
        .expect(200);

      await expect(count).resolves.toEqual({ unreadCount: 0 });
    });
  });
});
