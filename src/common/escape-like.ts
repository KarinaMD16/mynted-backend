// Escapa los comodines de LIKE/ILIKE (% _ \) para que el texto del usuario
// se busque literalmente.
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
