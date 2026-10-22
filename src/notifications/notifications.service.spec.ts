import { NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationType } from './enums/notification-type.enum';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const row = (userId: string, id = `n-${userId}`) => ({
    id,
    user_id: userId,
    type: NotificationType.REVIEW_RECEIVED,
    data: { productId: 1 },
    message: 'Reseña',
    read_at: null,
    created_at: new Date('2026-10-21T10:00:00Z'),
  });

  let service: NotificationsService;
  let query: jest.Mock;
  let repo: {
    findOne: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
  };
  let gateway: { emitNew: jest.Mock; emitUnreadCount: jest.Mock };

  beforeEach(() => {
    query = jest.fn();
    repo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      count: jest.fn().mockResolvedValue(4),
    };
    gateway = { emitNew: jest.fn(), emitUnreadCount: jest.fn() };
    service = new NotificationsService(
      repo as unknown as Repository<Notification>,
      { query } as unknown as DataSource,
      gateway,
    );
  });

  describe('notify', () => {
    it('no consulta nada sin destinatarios', async () => {
      await expect(service.notify([])).resolves.toEqual([]);
      expect(query).not.toHaveBeenCalled();
    });

    it('inserta en una sola consulta y emite a cada destinatario con su contador', async () => {
      query
        .mockResolvedValueOnce([row('ana'), row('beto')])
        .mockResolvedValueOnce([
          { user_id: 'ana', count: 3 },
          { user_id: 'beto', count: 1 },
        ]);

      const created = await service.notify(
        [
          {
            userId: 'ana',
            type: NotificationType.REVIEW_RECEIVED,
            data: { productId: 1 },
            message: 'Reseña',
            dedupeKey: 'product:1:price',
          },
          {
            userId: 'beto',
            type: NotificationType.REVIEW_RECEIVED,
            data: { productId: 1 },
            message: 'Reseña',
          },
        ],
        { preserveKeys: ['previousPrice'] },
      );

      expect(query).toHaveBeenCalledTimes(2);
      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('ON CONFLICT (user_id, dedupe_key)');
      expect(sql).toContain('u.is_active = true');
      expect(params).toEqual([
        ['ana', 'beto'],
        [NotificationType.REVIEW_RECEIVED, NotificationType.REVIEW_RECEIVED],
        ['{"productId":1}', '{"productId":1}'],
        ['Reseña', 'Reseña'],
        ['product:1:price', null],
        ['previousPrice'],
      ]);
      expect(created.map((n) => n.id)).toEqual(['n-ana', 'n-beto']);
      expect(gateway.emitNew).toHaveBeenCalledWith('ana', {
        notification: expect.objectContaining({ id: 'n-ana' }) as unknown,
        unreadCount: 3,
      });
      expect(gateway.emitNew).toHaveBeenCalledWith('beto', {
        notification: expect.objectContaining({ id: 'n-beto' }) as unknown,
        unreadCount: 1,
      });
    });

    it('no emite si todas eran de cuentas desactivadas', async () => {
      query.mockResolvedValueOnce([]);

      await service.notify([
        {
          userId: 'off',
          type: NotificationType.BADGE_AWARDED,
          data: {},
          message: 'x',
        },
      ]);

      expect(gateway.emitNew).not.toHaveBeenCalled();
      expect(query).toHaveBeenCalledTimes(1);
    });
  });

  describe('lectura y borrado', () => {
    it('solo busca las del propio usuario (404 si no es suya)', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.markRead('ana', 'n-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.remove('ana', 'n-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'n-1', userId: 'ana' },
      });
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('marcar como leída sincroniza el contador por socket', async () => {
      repo.findOne.mockResolvedValue({
        id: 'n-1',
        userId: 'ana',
        readAt: null,
      });

      const result = await service.markRead('ana', 'n-1');

      expect(result.readAt).toBeInstanceOf(Date);
      expect(gateway.emitUnreadCount).toHaveBeenCalledWith('ana', {
        unreadCount: 4,
      });
    });

    it('una ya leída no se vuelve a actualizar', async () => {
      const readAt = new Date('2026-10-20T00:00:00Z');
      repo.findOne.mockResolvedValue({ id: 'n-1', userId: 'ana', readAt });

      await expect(service.markRead('ana', 'n-1')).resolves.toMatchObject({
        readAt,
      });
      expect(repo.update).not.toHaveBeenCalled();
      expect(gateway.emitUnreadCount).not.toHaveBeenCalled();
    });

    it('marcar todas emite contador 0 solo si cambió algo', async () => {
      repo.update.mockResolvedValueOnce({ affected: 0 });
      await expect(service.markAllRead('ana')).resolves.toEqual({
        updated: 0,
        unreadCount: 0,
      });
      expect(gateway.emitUnreadCount).not.toHaveBeenCalled();

      repo.update.mockResolvedValueOnce({ affected: 2 });
      await service.markAllRead('ana');
      expect(gateway.emitUnreadCount).toHaveBeenCalledWith('ana', {
        unreadCount: 0,
      });
    });
  });
});

describe('NotificationsListener.safely', () => {
  it('loguea el error y no lo propaga', async () => {
    const listener = new NotificationsListener({} as NotificationsService);
    const logger = jest
      .spyOn(
        (listener as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    await expect(
      listener.safely('evento', () => Promise.reject(new Error('falló'))),
    ).resolves.toBeUndefined();
    expect(logger).toHaveBeenCalled();
  });
});
