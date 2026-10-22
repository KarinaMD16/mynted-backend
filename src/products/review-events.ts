// Reseñas de productos. ReviewsService lo emite (con EventEmitter2 opcional)
// después de guardar la reseña.
export const ReviewEvents = {
  CREATED: 'product.review.created',
} as const;

export interface ReviewCreatedEvent {
  reviewId: number;
  productId: number;
  authorId: string;
  // Dueño del producto (a quien se le avisa).
  sellerUserId: string;
  rating: number;
}
