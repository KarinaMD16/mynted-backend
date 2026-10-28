import { E2E_DB_NAME } from './e2e-database';

// Corre antes de cada suite e2e: @nestjs/config da prioridad a process.env
// sobre .env, así que todo AppModule/TypeORM de los tests usa la base e2e.
process.env.DB_NAME = E2E_DB_NAME;

// Sin caché del catálogo de cosméticos: los e2e cambian el catálogo en la base
// y esperan verlo al instante.
process.env.COSMETICS_CATALOG_CACHE_TTL_MS = '0';
