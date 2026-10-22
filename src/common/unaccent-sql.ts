// Quita los acentos del español en SQL con translate() (no requiere la
// extensión unaccent). Combinado con ILIKE da una búsqueda insensible a
// mayúsculas y tildes: "nino" encuentra "Niño". `expression` es una columna
// o un parámetro (':text'); nunca un valor del usuario interpolado.
const ACCENTED = 'áéíóúüñÁÉÍÓÚÜÑ';
const PLAIN = 'aeiouunAEIOUUN';

export function unaccentSql(expression: string): string {
  return `translate(${expression}, '${ACCENTED}', '${PLAIN}')`;
}
