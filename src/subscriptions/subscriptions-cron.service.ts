import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { NotificationInput } from '../notifications/notifications.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  SubscriptionNoticeRow,
  expiredNotification,
  expiringSoonNotification,
} from './subscription-notifications';

// Días antes de ends_at en que se avisa que está por vencer.
export const EXPIRING_NOTICE_DAYS = 3;
// Un vencimiento más viejo que esto ya no se avisa (p. ej. si el cron estuvo
// caído varios días): sería ruido, no un aviso útil.
export const EXPIRED_NOTICE_MAX_AGE_DAYS = 7;
const BATCH_SIZE = 200;
// Tope por corrida; lo que falte sigue en la del día siguiente.
const MAX_BATCHES = 100;

type NoticeColumn = 'expiring_notified_for' | 'expired_notified_for';

/**
 * Avisos diarios de la suscripción: por vencer (3 días antes de ends_at) y
 * vencida. Cada aviso se "reclama" con un UPDATE atómico sobre el marcador
 * de la fila (expiring_notified_for / expired_notified_for guardan el ends_at
 * ya avisado):
 *  - dos instancias o dos corridas no avisan dos veces lo mismo (el segundo
 *    UPDATE ya no encuentra filas, y FOR UPDATE SKIP LOCKED evita pisarse);
 *  - renovar cambia ends_at, así que el marcador deja de coincidir y se vuelve
 *    a avisar en el siguiente ciclo.
 * Las cuentas desactivadas no se reclaman: si se reactivan, se les avisa.
 */
@Injectable()
export class SubscriptionsCronService {
  private readonly logger = new Logger(SubscriptionsCronService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
  ) {}

  // 2 AM de Costa Rica (los demás crons usan la hora del servidor).
  @Cron('0 0 2 * * *', { timeZone: 'America/Costa_Rica' })
  async runDailyCron(): Promise<void> {
    try {
      const { expiring, expired } = await this.runOnce();
      if (expiring > 0 || expired > 0) {
        this.logger.log(
          `Avisos de suscripción enviados: ${expiring} por vencer, ${expired} vencidas`,
        );
      }
    } catch (error: unknown) {
      this.logger.error(
        'No se pudieron enviar los avisos de suscripción',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async runOnce(): Promise<{ expiring: number; expired: number }> {
    const expiring = await this.notifyExpiring();
    const expired = await this.notifyExpired();
    return { expiring, expired };
  }

  async notifyExpiring(): Promise<number> {
    return this.notifyBatches(
      'expiring_notified_for',
      `s.ends_at > now()
       AND s.ends_at <= now() + make_interval(days => $1::int)`,
      EXPIRING_NOTICE_DAYS,
      (row, now) => expiringSoonNotification(row, now),
    );
  }

  async notifyExpired(): Promise<number> {
    return this.notifyBatches(
      'expired_notified_for',
      `s.ends_at <= now()
       AND s.ends_at > now() - make_interval(days => $1::int)`,
      EXPIRED_NOTICE_MAX_AGE_DAYS,
      (row) => expiredNotification(row),
    );
  }

  private async notifyBatches(
    column: NoticeColumn,
    window: string,
    windowDays: number,
    build: (row: SubscriptionNoticeRow, now: Date) => NotificationInput,
  ): Promise<number> {
    let total = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const rows = await this.claim(column, window, windowDays);
      if (rows.length === 0) break;

      const now = new Date();
      try {
        await this.notificationsService.notify(
          rows.map((row) => build(row, now)),
        );
      } catch (error: unknown) {
        // No se avisó: se devuelve el reclamo para reintentar mañana.
        await this.release(
          column,
          rows.map((row) => row.subscriptionId),
        );
        throw error;
      }
      total += rows.length;
      if (rows.length < BATCH_SIZE) break;
    }
    return total;
  }

  // Marca como avisadas (con su ends_at actual) las filas pendientes y las
  // devuelve. El UPDATE va dentro de un CTE para que el resultado sea un
  // SELECT con las filas, no el par [filas, cantidad] de un UPDATE directo.
  private async claim(
    column: NoticeColumn,
    window: string,
    windowDays: number,
  ): Promise<SubscriptionNoticeRow[]> {
    return this.dataSource.query<SubscriptionNoticeRow[]>(
      `WITH due AS (
         SELECT s.id
           FROM subscription s
           JOIN users u ON u.id = s.user_id AND u.is_active = true
          WHERE ${window}
            AND s.${column} IS DISTINCT FROM s.ends_at
          ORDER BY s.ends_at
          LIMIT ${BATCH_SIZE}
            FOR UPDATE OF s SKIP LOCKED
       ), claimed AS (
         UPDATE subscription s
            SET ${column} = s.ends_at
           FROM due
          WHERE s.id = due.id
      RETURNING s.id AS "subscriptionId",
                s.user_id AS "userId",
                s.period AS "period",
                s.ends_at AS "endsAt",
                s.cancel_at_period_end AS "cancelAtPeriodEnd"
       )
       SELECT * FROM claimed`,
      [windowDays],
    );
  }

  private async release(
    column: NoticeColumn,
    subscriptionIds: string[],
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE subscription SET ${column} = NULL
        WHERE id = ANY($1::uuid[]) AND ${column} = ends_at`,
      [subscriptionIds],
    );
  }
}
