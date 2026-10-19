// Base exclusiva de los tests e2e. Las suites recrean su esquema
// (dropSchema), así que nunca debe ser la base de desarrollo.
export const E2E_DB_NAME = process.env.E2E_DB_NAME ?? 'mynted_db_e2e';
