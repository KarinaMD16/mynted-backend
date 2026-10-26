import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Estado Pro de los usuarios. Es Pro quien tiene una suscripción con
 * ends_at > now(): el estado no se guarda, así que vencer y renovar no
 * requieren ningún job. Las listas se resuelven con una sola consulta por
 * lote (nunca una por usuario).
 */
@Injectable()
export class ProStatusService {
  constructor(private readonly dataSource: DataSource) {}

  // Subconjunto de userIds que es Pro ahora mismo.
  async proUserIds(userIds: Iterable<string>): Promise<Set<string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Set();

    const rows = await this.dataSource.query<{ user_id: string }[]>(
      `SELECT user_id FROM subscription
        WHERE user_id = ANY($1::uuid[]) AND ends_at > now()`,
      [ids],
    );
    return new Set(rows.map((row) => row.user_id));
  }

  async isPro(userId: string): Promise<boolean> {
    return (await this.proUserIds([userId])).has(userId);
  }
}
