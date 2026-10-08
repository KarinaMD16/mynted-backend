// Eventos de dominio que disparan la evaluación de badges. Los servicios
// emiten el evento (con EventEmitter2 opcional) y BadgesListener los atiende
// de forma asíncrona: un fallo al otorgar un badge nunca rompe la petición.
export const BadgeEvents = {
  POST_CREATED: 'forum.post.created',
  REPLY_CREATED: 'forum.reply.created',
  COMMUNITY_CREATED: 'community.created',
  MEMBER_JOINED: 'community.member.joined',
  MODERATOR_ASSIGNED: 'community.moderator.assigned',
  SELLER_APPROVED: 'seller.approved',
  PRODUCT_PUBLISHED: 'product.published',
} as const;

export interface PostCreatedEvent {
  userId: string;
  communityProfileId: number;
}

export interface ReplyCreatedEvent {
  userId: string;
}

export interface CommunityCreatedEvent {
  userId: string;
  communityProfileId: number;
}

export interface MemberJoinedEvent {
  userId: string;
  communityProfileId: number;
  communityId: number;
}

export interface ModeratorAssignedEvent {
  communityProfileId: number;
}

export interface SellerApprovedEvent {
  userId: string;
}

export interface ProductPublishedEvent {
  userId: string;
}
