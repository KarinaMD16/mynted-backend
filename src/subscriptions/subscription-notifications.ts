import { NotificationInput } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import { SubscriptionPaymentCompletedEvent } from './subscription-events';
import { SubscriptionPeriod } from './subscription-period.enum';

// Qué avisa cada notificación de la suscripción. Lo comparten el listener del
// pago y el cron, así el texto y el data salen siempre de un solo lugar.
// El front arma su propio texto desde type + data; message es el respaldo.

// Fecha para los textos de respaldo, en la hora de Costa Rica.
function formatDate(date: Date): string {
  return date.toLocaleDateString('es-CR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Costa_Rica',
  });
}

// dedupe_key es solo una red de seguridad: el control real de los avisos del
// cron son los marcadores expiring_notified_for / expired_notified_for.
export function paymentConfirmedNotification(
  event: SubscriptionPaymentCompletedEvent,
): NotificationInput {
  return {
    userId: event.userId,
    type: NotificationType.SUBSCRIPTION_PAYMENT_CONFIRMED,
    data: {
      paymentId: event.paymentId,
      period: event.period,
      amount: event.amount,
      currency: event.currency,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      renewal: event.renewal,
    },
    message: `Pago de Mynted Pro confirmado: tienes Pro hasta el ${formatDate(event.endsAt)}`,
    dedupeKey: `subscription_payment_confirmed:${event.paymentId}`,
  };
}

export interface SubscriptionNoticeRow {
  subscriptionId: string;
  userId: string;
  period: SubscriptionPeriod;
  endsAt: Date;
  cancelAtPeriodEnd: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function expiringSoonNotification(
  row: SubscriptionNoticeRow,
  now: Date,
): NotificationInput {
  const endsAt = formatDate(row.endsAt);
  return {
    userId: row.userId,
    type: NotificationType.SUBSCRIPTION_EXPIRING_SOON,
    data: {
      subscriptionId: row.subscriptionId,
      period: row.period,
      endsAt: row.endsAt,
      daysRemaining: Math.max(
        0,
        Math.ceil((row.endsAt.getTime() - now.getTime()) / DAY_MS),
      ),
      // El front adapta el texto: si canceló, no hay nada que "renovar solo".
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    },
    message: row.cancelAtPeriodEnd
      ? `Tu Mynted Pro vence el ${endsAt}. Cancelaste la renovación: paga de nuevo si quieres seguir con Pro`
      : `Tu Mynted Pro vence el ${endsAt}. Renuévalo para no perder tus beneficios`,
    dedupeKey: `subscription_expiring_soon:${row.subscriptionId}:${row.endsAt.toISOString()}`,
  };
}

export function expiredNotification(
  row: SubscriptionNoticeRow,
): NotificationInput {
  return {
    userId: row.userId,
    type: NotificationType.SUBSCRIPTION_EXPIRED,
    data: {
      subscriptionId: row.subscriptionId,
      period: row.period,
      endsAt: row.endsAt,
    },
    message: `Tu Mynted Pro venció el ${formatDate(row.endsAt)}. Renuévalo para recuperar tus beneficios`,
    dedupeKey: `subscription_expired:${row.subscriptionId}:${row.endsAt.toISOString()}`,
  };
}
