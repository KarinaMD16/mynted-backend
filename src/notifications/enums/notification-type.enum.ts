export enum NotificationType {
  // Favoritos (tarea 1044). Precio y disponibilidad se unifican por producto.
  FAVORITE_PRICE_CHANGED = 'favorite_price_changed',
  FAVORITE_UNAVAILABLE = 'favorite_unavailable',
  FAVORITE_AVAILABLE_AGAIN = 'favorite_available_again',
  // Pagos.
  PURCHASE_COMPLETED = 'purchase_completed',
  SALE_COMPLETED = 'sale_completed',
  // Reseñas y badges.
  REVIEW_RECEIVED = 'review_received',
  BADGE_AWARDED = 'badge_awarded',
  // Comunidades.
  COMMUNITY_JOIN_REQUESTED = 'community_join_requested',
  COMMUNITY_JOIN_ACCEPTED = 'community_join_accepted',
  COMMUNITY_JOIN_REJECTED = 'community_join_rejected',
  COMMUNITY_DEACTIVATED = 'community_deactivated',
  COMMUNITY_ACTIVATED = 'community_activated',
  COMMUNITY_MADE_PUBLIC = 'community_made_public',
  COMMUNITY_MADE_PRIVATE = 'community_made_private',
  COMMUNITY_DELETED = 'community_deleted',
  COMMUNITY_MEMBER_REMOVED = 'community_member_removed',
  // Solicitud de vendedor.
  SELLER_REQUEST_APPROVED = 'seller_request_approved',
  SELLER_REQUEST_REJECTED = 'seller_request_rejected',
  SELLER_REVOKED = 'seller_revoked',
  SELLER_RESTORED = 'seller_restored',
  // Suscripción Pro.
  SUBSCRIPTION_PAYMENT_CONFIRMED = 'subscription_payment_confirmed',
  SUBSCRIPTION_EXPIRING_SOON = 'subscription_expiring_soon',
  SUBSCRIPTION_EXPIRED = 'subscription_expired',
  // Foro.
  POST_REPLIED = 'post_replied',
  REPLY_REPLIED = 'reply_replied',
  CONTENT_HIDDEN = 'content_hidden',
  CONTENT_RESTORED = 'content_restored',
  COMMUNITY_MODERATION_WARNING = 'community_moderation_warning',
  PRODUCT_DEACTIVATED = 'product_deactivated',
  PRODUCT_ACTIVATED = 'product_activated',
  PRODUCT_DELETED = 'product_deleted',
  MODERATION_WARNING = 'moderation_warning',
  USER_DEACTIVATED = 'user_deactivated',
  USER_REACTIVATED = 'user_reactivated',
}
