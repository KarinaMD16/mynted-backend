// Eventos de dominio de pagos. PaymentsService los emite (con EventEmitter2
// opcional) después del commit; otros módulos (p. ej. notificaciones) los
// escuchan sin que pagos dependa de ellos.
export const PaymentEvents = {
  CHECKOUT_COMPLETED: 'payment.checkout.completed',
} as const;

// Un pago recién aprobado (nunca se emite al repetir una clave de
// idempotencia). sellerId es seller.seller_id, no el user_id del vendedor.
export interface CheckoutCompletedEvent {
  transactionId: string;
  productId: number;
  buyerId: string;
  sellerId: number;
  amount: number;
  currency: string;
  // Unidades compradas y si este pago dejó el producto agotado.
  quantity: number;
  soldOut: boolean;
}
