import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

export const READ_RETENTION_DAYS = 90;
export const UNREAD_RETENTION_DAYS = 180;
const BATCH_SIZE = 1000;
// Tope por corrida para no monopolizar la base; lo que falte sigue mañana.
const MAX_BATCHES = 500;

/**
 * Limpieza diaria de notificaciones: borra las leídas de más de 90 días y
 * las no leídas de más de 180 (por created_at, que se renueva al unificar).
 * Borra en lotes para no bloquear la tabla.
 */
@Injectable()
export class NotificationsRetentionService {
  private readonly logger = new Logger(NotificationsRetentionService.name);

  constructor(private readonly dataSource: DataSource) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async runRetentionCron(): Promise<void> {
    try {
      const deleted = await this.purgeExpired();
      if (deleted > 0) {
        this.logger.log(`Notificaciones vencidas borradas: ${deleted}`);
      }
    } catch (error: unknown) {
      this.logger.error(
        'No se pudieron borrar las notificaciones vencidas',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async purgeExpired(batchSize = BATCH_SIZE): Promise<number> {
    let total = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const rows = await this.dataSource.query<{ count: number }[]>(
        `WITH doomed AS (
           SELECT id FROM notification
            WHERE (read_at IS NOT NULL
                   AND created_at < now() - make_interval(days => $1::int))
               OR (read_at IS NULL
                   AND created_at < now() - make_interval(days => $2::int))
            LIMIT $3
         ), deleted AS (
           DELETE FROM notification n USING doomed
            WHERE n.id = doomed.id
           RETURNING 1
         )
         SELECT COUNT(*)::int AS count FROM deleted`,
        [READ_RETENTION_DAYS, UNREAD_RETENTION_DAYS, batchSize],
      );
      const deleted = rows[0]?.count ?? 0;
      total += deleted;
      if (deleted < batchSize) break;
    }
    return total;
  }
}
