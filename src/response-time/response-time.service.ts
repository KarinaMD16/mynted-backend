import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ResponseTimeDto } from './response-time.dto';

export const RESPONSE_TIME_WINDOW_DAYS = 90;
export const RESPONSE_TIME_MIN_SAMPLE = 3;
const CACHE_TTL_MS = 10 * 60_000;
// Tope de entradas antes de limpiar las vencidas.
const CACHE_PRUNE_SIZE = 10_000;

// Por conversación donde el usuario es el vendedor (conversation.seller_id es
// el user_id del dueño del producto): minutos entre el primer mensaje del
// comprador y el primer mensaje del vendedor posterior a ese. Los mensajes
// del vendedor anteriores al primero del comprador se ignoran, las
// conversaciones sin respuesta no cuentan y las de productos borrados sí (no
// se mira el producto). La ventana se mide desde el primer mensaje del
// comprador.
const RESPONSE_TIME_SQL = `
  WITH first_question AS (
    SELECT c.id, c.seller_id, MIN(m.created_at) AS asked_at
      FROM conversation c
      JOIN message m
        ON m.conversation_id = c.id AND m.sender_id = c.buyer_id
     WHERE c.seller_id = ANY($1::uuid[])
     GROUP BY c.id, c.seller_id
    HAVING MIN(m.created_at) >= now() - make_interval(days => $2::int)
  ), answered AS (
    SELECT q.seller_id,
           EXTRACT(EPOCH FROM (MIN(m.created_at) - q.asked_at)) / 60 AS minutes
      FROM first_question q
      JOIN message m
        ON m.conversation_id = q.id
       AND m.sender_id = q.seller_id
       AND m.created_at > q.asked_at
     GROUP BY q.seller_id, q.id, q.asked_at
  )
  SELECT seller_id AS user_id,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes) AS median_minutes,
         COUNT(*)::int AS sample_size
    FROM answered
   GROUP BY seller_id`;

interface ResponseTimeRow {
  user_id: string;
  median_minutes: number | string;
  sample_size: number;
}

interface CachedResponseTime {
  value: ResponseTimeDto | null;
  expiresAt: number;
}

@Injectable()
export class ResponseTimeService {
  private readonly cache = new Map<string, CachedResponseTime>();

  constructor(private readonly dataSource: DataSource) {}

  async getForUser(userId: string): Promise<ResponseTimeDto | null> {
    return (await this.getForUsers([userId])).get(userId) ?? null;
  }

  // Una sola consulta para todos los vendedores que no estén en caché.
  // null si tiene menos de RESPONSE_TIME_MIN_SAMPLE conversaciones
  // respondidas.
  async getForUsers(
    userIds: string[],
  ): Promise<Map<string, ResponseTimeDto | null>> {
    const now = Date.now();
    const result = new Map<string, ResponseTimeDto | null>();
    const missing: string[] = [];
    for (const userId of new Set(userIds)) {
      const cached = this.cache.get(userId);
      if (cached && cached.expiresAt > now) result.set(userId, cached.value);
      else missing.push(userId);
    }
    if (missing.length === 0) return result;

    const rows = await this.dataSource.query<ResponseTimeRow[]>(
      RESPONSE_TIME_SQL,
      [missing, RESPONSE_TIME_WINDOW_DAYS],
    );
    const rowByUser = new Map(rows.map((row) => [row.user_id, row]));

    this.pruneExpired(now);
    for (const userId of missing) {
      const row = rowByUser.get(userId);
      const value =
        row && row.sample_size >= RESPONSE_TIME_MIN_SAMPLE
          ? {
              medianMinutes: Math.round(Number(row.median_minutes)),
              sampleSize: row.sample_size,
            }
          : null;
      this.cache.set(userId, { value, expiresAt: now + CACHE_TTL_MS });
      result.set(userId, value);
    }
    return result;
  }

  private pruneExpired(now: number): void {
    if (this.cache.size < CACHE_PRUNE_SIZE) return;
    for (const [userId, cached] of this.cache) {
      if (cached.expiresAt <= now) this.cache.delete(userId);
    }
  }
}
