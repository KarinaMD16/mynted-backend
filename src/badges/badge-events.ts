// Eventos de dominio que disparan la evaluación de badges. Los servicios
// emiten el evento (con EventEmitter2 opcional) y BadgesListener los atiende
// de forma asíncrona: un fallo al otorgar un badge nunca rompe la acción
// principal.
export const BadgeEvents = {
  USER_REGISTERED: 'user.registered',
  POST_CREATED: 'forum.post.created',
  REPLY_CREATED: 'forum.reply.created',
  POST_UPVOTED: 'forum.post.upvoted',
  MEMBER_JOINED: 'community.member.joined',
  SELLER_APPROVED: 'seller.approved',
  PRODUCT_PUBLISHED: 'product.published',
  FAVORITE_SAVED: 'favorite.saved',
} as const;

export interface UserRegisteredEvent {
  userId: string;
}

export interface PostCreatedEvent {
  communityProfileId: number;
}

export interface ReplyCreatedEvent {
  communityProfileId: number;
  // Para notificaciones (BadgesListener solo usa communityProfileId).
  postId: number;
  replyId: number;
  authorUserId: string;
  parentReplyId: number | null;
}

export interface PostUpvotedEvent {
  postId: number;
}

export interface MemberJoinedEvent {
  communityProfileId: number;
  communityId: number;
}

export interface SellerApprovedEvent {
  userId: string;
}

export interface ProductPublishedEvent {
  userId: string;
  // null si el producto se publicó sin comunidad (no suma a ningún perfil).
  communityId: number | null;
}

export interface FavoriteSavedEvent {
  userId: string;
  itemType: 'POST' | 'PRODUCT' | 'REPLY';
  itemId: number;
}
