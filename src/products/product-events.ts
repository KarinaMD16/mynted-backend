// Eventos de dominio de productos para avisar a quienes los guardaron en
// favoritos. ProductsService los emite (con EventEmitter2 opcional) después
// del commit; el pago aprobado se avisa con payment.checkout.completed.
export const ProductEvents = {
  PRICE_CHANGED: 'product.price.changed',
  AVAILABILITY_CHANGED: 'product.availability.changed',
} as const;

// Por qué un producto dejó de estar disponible.
export type UnavailableReason = 'sold' | 'inactive' | 'hidden' | 'deleted';

// Cambió el precio final (price con discountPercent aplicado).
export interface ProductPriceChangedEvent {
  productId: number;
  // Quien hizo el cambio (el vendedor): no se le avisa.
  actorUserId: string;
  productTitle: string;
  currency: string;
  previousPrice: number;
  newPrice: number;
}

// Pasó de disponible (activo, visible y no borrado) a no disponible o al
// revés.
export interface ProductAvailabilityChangedEvent {
  productId: number;
  actorUserId: string;
  productTitle: string;
  available: boolean;
  // null cuando vuelve a estar disponible.
  reason: UnavailableReason | null;
}
