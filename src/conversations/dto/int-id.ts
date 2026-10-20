// Los ids de conversation, message y product son int4 en Postgres. Un entero
// mayor pasa @IsInt pero revienta en la base (22003 → 500), así que los DTOs y
// el guard lo rechazan antes con 400.
export const MAX_INT4_ID = 2_147_483_647;

export function isValidIntId(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_INT4_ID;
}
