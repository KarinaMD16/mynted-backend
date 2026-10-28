import { SubscriptionPeriod } from './subscription-period.enum';

export const SubscriptionEvents = {
  // Después del commit de un pago aprobado (no se repite al reintentar la
  // misma Idempotency-Key).
  PAYMENT_COMPLETED: 'subscription.payment.completed',
} as const;

export interface SubscriptionPaymentCompletedEvent {
  paymentId: string;
  userId: string;
  period: SubscriptionPeriod;
  amount: number;
  currency: string;
  startsAt: Date;
  endsAt: Date;
  // true si ya tenía la suscripción vigente (se extendió); false si es la
  // primera vez o volvió después de vencer.
  renewal: boolean;
}
