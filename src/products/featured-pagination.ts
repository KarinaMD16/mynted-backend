// Cuota de destacados por página. Función pura: dado el total de destacados
// efectivos (F) y de no destacados (R) que cumplen los filtros, dice qué
// rebanada de cada grupo va en la página p, de modo que:
//  - cada producto aparece en una sola página;
//  - el total es F + R y las páginas son ceil((F + R) / limit);
//  - todas las páginas vienen llenas salvo la última;
//  - los destacados van primero en cada página, y como máximo una cuarta parte
//    de la página mientras queden no destacados con qué llenarla.

// Q: destacados máximos por página. Con limit < 2 no hay cuota (una página de
// un solo ítem no se reparte).
export function featuredQuota(limit: number): number {
  return limit < 2 ? 0 : Math.max(1, Math.floor(limit / 4));
}

export interface FeaturedPageInput {
  page: number; // desde 1
  limit: number;
  featuredTotal: number; // F
  regularTotal: number; // R
}

export interface FeaturedPageSlots {
  quota: number;
  // Rebanada de destacados (ordenados por featured_at DESC, id DESC).
  featuredOffset: number;
  featuredCount: number;
  // Rebanada de no destacados (en el orden elegido por el usuario).
  regularOffset: number;
  regularCount: number;
}

/**
 * Mientras quedan no destacados de sobra, una página lleva
 * min(Q, destacados restantes) destacados y el resto no destacados:
 *   destacados de la página = min(Q, max(0, F - (p-1)·Q))
 *   destacados anteriores   = min(F, (p-1)·Q)
 *   offset no destacados    = (p-1)·limit - destacados anteriores
 *   no destacados           = limit - destacados de la página
 * Cuando los no destacados restantes no alcanzan a llenar la página, los
 * destacados que faltan la completan (si no, quedarían en una página que
 * ceil((F+R)/limit) no cuenta y el producto se perdería).
 */
export function computeFeaturedPage(
  input: FeaturedPageInput,
): FeaturedPageSlots {
  const { page, limit, featuredTotal, regularTotal } = input;
  const quota = featuredQuota(limit);
  const empty: FeaturedPageSlots = {
    quota,
    featuredOffset: featuredTotal,
    featuredCount: 0,
    regularOffset: regularTotal,
    regularCount: 0,
  };
  // Una página más allá del último producto está vacía (y evita recorrer
  // miles de páginas con un page enorme).
  if (
    page < 1 ||
    limit < 1 ||
    (page - 1) * limit >= featuredTotal + regularTotal
  ) {
    return empty;
  }

  let featuredBefore = 0;
  let regularBefore = 0;
  for (let current = 1; current <= page; current += 1) {
    const featuredLeft = featuredTotal - featuredBefore;
    const regularLeft = regularTotal - regularBefore;
    const featuredCount = Math.min(
      featuredLeft,
      Math.max(quota, limit - regularLeft),
    );
    const regularCount = Math.min(regularLeft, limit - featuredCount);
    if (current === page) {
      return {
        quota,
        featuredOffset: featuredBefore,
        featuredCount,
        regularOffset: regularBefore,
        regularCount,
      };
    }
    featuredBefore += featuredCount;
    regularBefore += regularCount;
  }
  return empty;
}
