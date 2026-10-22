import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import {
  MarkAllReadDto,
  NotificationDto,
  NotificationListQueryDto,
  UnreadCountDto,
} from './dto/notification.dto';
import { Notification } from './entities/notification.entity';
import { NotificationType } from './enums/notification-type.enum';
import { NotificationsGateway } from './notifications.gateway';

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  data: Record<string, unknown>;
  message: string;
  // Unifica con la no leída que tenga la misma clave (solo precio y
  // disponibilidad de favoritos).
  dedupeKey?: string;
}

export interface NotifyOptions {
  // Claves de data que se conservan de la notificación que se unifica (p. ej.
  // previousPrice: el precio que el usuario vio por última vez).
  preserveKeys?: string[];
}

// Fila que devuelve el INSERT ... RETURNING.
export interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  data: Record<string, unknown>;
  message: string;
  read_at: Date | null;
  created_at: Date;
}

const RETURNING =
  'RETURNING id, user_id, type, data, message, read_at, created_at';

// Unifica con la no leída de la misma clave: actualiza tipo, data y mensaje
// y renueva created_at para que vuelva arriba. $preserve es el índice del
// parámetro text[] con las claves de data que se conservan.
export const dedupeUpsertSql = (preserve: number) => `
  ON CONFLICT (user_id, dedupe_key)
    WHERE read_at IS NULL AND dedupe_key IS NOT NULL
  DO UPDATE SET
    type = EXCLUDED.type,
    data = EXCLUDED.data || COALESCE(
      (SELECT jsonb_object_agg(key, value)
         FROM jsonb_each(notification.data)
        WHERE key = ANY($${preserve}::text[])),
      '{}'::jsonb),
    message = EXCLUDED.message,
    created_at = now()
  ${RETURNING}`;

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    private readonly dataSource: DataSource,
    private readonly gateway: NotificationsGateway,
  ) {}

  // Crea las notificaciones en un solo INSERT (las de cuentas desactivadas se
  // descartan), unifica las que traen dedupeKey y las emite por socket.
  async notify(
    inputs: NotificationInput[],
    options: NotifyOptions = {},
  ): Promise<NotificationDto[]> {
    if (inputs.length === 0) return [];
    const rows = await this.dataSource.query<NotificationRow[]>(
      `INSERT INTO notification (user_id, type, data, message, dedupe_key)
       SELECT i.user_id, i.type::notification_type_enum, i.data::jsonb,
              i.message, i.dedupe_key
         FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[])
              AS i(user_id, type, data, message, dedupe_key)
         JOIN users u ON u.id = i.user_id AND u.is_active = true
       ${dedupeUpsertSql(6)}`,
      [
        inputs.map((input) => input.userId),
        inputs.map((input) => input.type),
        inputs.map((input) => JSON.stringify(input.data)),
        inputs.map((input) => input.message),
        inputs.map((input) => input.dedupeKey ?? null),
        options.preserveKeys ?? [],
      ],
    );
    return this.emitCreated(rows);
  }

  // Emite notification:new a cada destinatario con su contador actualizado
  // (una sola consulta de contadores para todos).
  async emitCreated(rows: NotificationRow[]): Promise<NotificationDto[]> {
    if (rows.length === 0) return [];
    const counts = await this.unreadCounts(rows.map((row) => row.user_id));
    const created = rows.map((row) => {
      const notification = this.toDto(row);
      this.gateway.emitNew(row.user_id, {
        notification,
        unreadCount: counts.get(row.user_id) ?? 0,
      });
      return notification;
    });
    return created;
  }

  async list(userId: string, query: NotificationListQueryDto) {
    const [rows, total] = await this.notificationRepository.findAndCount({
      where: { userId, ...(query.unread ? { readAt: IsNull() } : {}) },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return {
      data: rows.map((row) => this.toDto(row)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async unreadCount(userId: string): Promise<UnreadCountDto> {
    const unreadCount = await this.notificationRepository.count({
      where: { userId, readAt: IsNull() },
    });
    return { unreadCount };
  }

  async markRead(userId: string, id: string): Promise<NotificationDto> {
    const notification = await this.findOwn(userId, id);
    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.notificationRepository.update(
        { id, userId },
        { readAt: notification.readAt },
      );
      await this.syncUnreadCount(userId);
    }
    return this.toDto(notification);
  }

  async markAllRead(userId: string): Promise<MarkAllReadDto> {
    const result = await this.notificationRepository.update(
      { userId, readAt: IsNull() },
      { readAt: new Date() },
    );
    const updated = result.affected ?? 0;
    if (updated > 0) this.gateway.emitUnreadCount(userId, { unreadCount: 0 });
    return { updated, unreadCount: 0 };
  }

  async remove(userId: string, id: string): Promise<void> {
    const notification = await this.findOwn(userId, id);
    await this.notificationRepository.delete({ id, userId });
    if (!notification.readAt) await this.syncUnreadCount(userId);
  }

  // Solo las propias: la de otro usuario responde 404 igual que una
  // inexistente.
  private async findOwn(userId: string, id: string): Promise<Notification> {
    const notification = await this.notificationRepository.findOne({
      where: { id, userId },
    });
    if (!notification) {
      throw new NotFoundException('Notificación no encontrada');
    }
    return notification;
  }

  private async syncUnreadCount(userId: string): Promise<void> {
    this.gateway.emitUnreadCount(userId, await this.unreadCount(userId));
  }

  private async unreadCounts(userIds: string[]): Promise<Map<string, number>> {
    const rows = await this.dataSource.query<
      { user_id: string; count: number }[]
    >(
      `SELECT user_id, COUNT(*)::int AS count
         FROM notification
        WHERE read_at IS NULL AND user_id = ANY($1::uuid[])
        GROUP BY user_id`,
      [[...new Set(userIds)]],
    );
    return new Map(rows.map((row) => [row.user_id, row.count]));
  }

  private toDto(row: Notification | NotificationRow): NotificationDto {
    return {
      id: row.id,
      type: row.type,
      data: row.data,
      message: row.message,
      readAt: 'readAt' in row ? row.readAt : row.read_at,
      createdAt: 'createdAt' in row ? row.createdAt : row.created_at,
    };
  }
}
