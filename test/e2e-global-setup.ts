import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { DataSource } from 'typeorm';
import { E2E_DB_NAME } from './e2e-database';

// Una vez antes de todo test:e2e: verifica que la base e2e no sea la de
// desarrollo y la crea si no existe. Las credenciales salen de .env (sin
// cargarlo en process.env) o del entorno.
export default async function globalSetup(): Promise<void> {
  const envFile = join(__dirname, '..', '.env');
  const env: Record<string, string | undefined> = {
    ...(existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {}),
    ...process.env,
  };

  if (E2E_DB_NAME === env.DB_NAME || !/^[a-z0-9_]+$/i.test(E2E_DB_NAME)) {
    throw new Error(
      `Base e2e inválida (${E2E_DB_NAME}): debe ser distinta de DB_NAME (${env.DB_NAME})`,
    );
  }

  // Conexión de mantenimiento a 'postgres' solo para crear la base e2e.
  const admin = new DataSource({
    type: 'postgres',
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    username: env.DB_USERNAME,
    password: String(env.DB_PASSWORD),
    database: 'postgres',
  });
  await admin.initialize();
  try {
    const existing = await admin.query<unknown[]>(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [E2E_DB_NAME],
    );
    if (existing.length === 0) {
      await admin.query(`CREATE DATABASE "${E2E_DB_NAME}"`);
    }
  } finally {
    await admin.destroy();
  }
}
