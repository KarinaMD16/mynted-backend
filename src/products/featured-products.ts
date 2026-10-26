// Productos destacados (Pro). La preferencia vive en product.featured_at; que
// el producto sea "destacado efectivo" se calcula al leer, sin jobs: así vencer
// Pro, vender, desactivar o perder el rol lo deja de elevar y renovar o
// reactivar lo restablece, sin borrar nunca featured_at.

// Cuántos destacados efectivos puede tener cada vendedor a la vez.
export const MAX_FEATURED_PER_SELLER = 3;

/**
 * Condición SQL (para QueryBuilder o consultas crudas) de "destacado
 * efectivo" sobre la tabla product con el alias dado:
 *  - tiene featured_at (la preferencia);
 *  - el producto está activo, visible, con stock y no borrado;
 *  - el vendedor está aprobado (seller.is_verified), su usuario está activo y
 *    tiene Pro vigente (suscripción con ends_at > now());
 *  - el producto no tiene comunidad, o su comunidad es pública y activa: un
 *    producto de una comunidad privada o inactiva NUNCA se eleva.
 *
 * Los alias internos llevan el prefijo del alias recibido para poder anidar la
 * condición en subconsultas sin chocar.
 */
export function effectiveFeaturedCondition(alias: string): string {
  return `(
    ${alias}.featured_at IS NOT NULL
    AND ${alias}.status = 'active'
    AND ${alias}.is_visible = true
    AND ${alias}.quantity > 0
    AND ${alias}.deleted_at IS NULL
    AND (
      ${alias}.community_id IS NULL
      OR EXISTS (
        SELECT 1 FROM community ${alias}_c
         WHERE ${alias}_c.id = ${alias}.community_id
           AND ${alias}_c.is_active = true
           AND ${alias}_c.is_private = false
      )
    )
    AND EXISTS (
      SELECT 1
        FROM seller ${alias}_s
        JOIN users ${alias}_u ON ${alias}_u.id = ${alias}_s.user_id
       WHERE ${alias}_s.seller_id = ${alias}.seller_id
         AND ${alias}_s.is_verified = true
         AND ${alias}_u.is_active = true
         AND EXISTS (
           SELECT 1 FROM subscription ${alias}_sub
            WHERE ${alias}_sub.user_id = ${alias}_s.user_id
              AND ${alias}_sub.ends_at > now()
         )
    )
  )`;
}

/**
 * Lo mismo, recortado al tope por vendedor: si un vendedor llega a tener más
 * efectivos que el tope (p. ej. al reactivar productos que conservaban su
 * featured_at), solo cuentan los más recientes (featured_at DESC, id DESC).
 * Es la condición que usan los listados, el summary y isFeatured.
 */
export function cappedFeaturedCondition(
  alias: string,
  limit: number = MAX_FEATURED_PER_SELLER,
): string {
  const max = Math.max(0, Math.floor(limit));
  return `(
    ${effectiveFeaturedCondition(alias)}
    AND ${alias}.id IN (
      SELECT ranked.id FROM (
        SELECT fp.id,
               ROW_NUMBER() OVER (
                 PARTITION BY fp.seller_id
                 ORDER BY fp.featured_at DESC, fp.id DESC
               ) AS rn
          FROM product fp
         WHERE ${effectiveFeaturedCondition('fp')}
      ) ranked
      WHERE ranked.rn <= ${max}
    )
  )`;
}
