// Regla única de "¿puede este usuario reseñar este producto?". La usan tanto
// POST /products/:id/reviews (como 403/409) como canReview del detalle y de
// GET /payments/me/purchases, así nunca se contradicen.

// Por qué un usuario no puede reseñar un producto, en el orden en que se
// evalúa.
export enum ReviewIneligibility {
  OWN_PRODUCT = 'own_product',
  EXCHANGE_PRODUCT = 'exchange_product',
  NOT_PURCHASED = 'not_purchased',
  ALREADY_REVIEWED = 'already_reviewed',
}

export interface ReviewEligibilityFacts {
  // El usuario es el vendedor del producto.
  isOwner: boolean;
  // El producto es de intercambio (aún no se reseñan).
  isExchange: boolean;
  // Tiene al menos una compra con status completed del producto (pending,
  // failed y refunded no cuentan).
  purchased: boolean;
  // Ya tiene una reseña propia del producto.
  hasReviewed: boolean;
}

// null = puede reseñar.
export function resolveReviewIneligibility(
  facts: ReviewEligibilityFacts,
): ReviewIneligibility | null {
  if (facts.isOwner) return ReviewIneligibility.OWN_PRODUCT;
  if (facts.isExchange) return ReviewIneligibility.EXCHANGE_PRODUCT;
  if (!facts.purchased) return ReviewIneligibility.NOT_PURCHASED;
  if (facts.hasReviewed) return ReviewIneligibility.ALREADY_REVIEWED;
  return null;
}

// Los tres campos que ve el frontend.
export interface ReviewStatus {
  canReview: boolean;
  hasReviewed: boolean;
  reviewId: number | null;
}

// Sin sesión: no puede reseñar y no tiene reseña.
export const NO_SESSION_REVIEW_STATUS: ReviewStatus = {
  canReview: false,
  hasReviewed: false,
  reviewId: null,
};
