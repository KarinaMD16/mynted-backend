// La aprobación se emite como BadgeEvents.SELLER_APPROVED ('seller.approved'),
// que además otorga el badge verified_seller. El rechazo no tiene badge.
export const SellerEvents = {
  REJECTED: 'seller.rejected',
} as const;

export interface SellerRejectedEvent {
  userId: string;
}
