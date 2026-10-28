// Costa Rica no tiene horario de verano: UTC-6 todo el año.
const COSTA_RICA_UTC_OFFSET_MINUTES = -6 * 60;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * Suma meses de calendario conservando la hora. Si el día no existe en el mes
 * de destino se usa el último día de ese mes: 31 de enero + 1 mes = 28 o 29 de
 * febrero. El cálculo se hace en la hora de Costa Rica, así que "el día" es el
 * que ve el usuario y no el de UTC.
 *
 * Al encadenar renovaciones el día no se recupera (31 ene -> 28 feb -> 28 mar):
 * cada renovación suma desde el vencimiento anterior.
 */
export function addCalendarMonths(
  date: Date,
  months: number,
  utcOffsetMinutes = COSTA_RICA_UTC_OFFSET_MINUTES,
): Date {
  const local = new Date(date.getTime() + utcOffsetMinutes * MINUTE_MS);
  const day = local.getUTCDate();

  const target = new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth() + months,
      1,
      local.getUTCHours(),
      local.getUTCMinutes(),
      local.getUTCSeconds(),
      local.getUTCMilliseconds(),
    ),
  );
  const lastDayOfTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDayOfTargetMonth));

  return new Date(target.getTime() - utcOffsetMinutes * MINUTE_MS);
}

// Estado de la suscripción. No se guarda: se deriva de ends_at y
// cancel_at_period_end.
export type SubscriptionStatus = 'none' | 'active' | 'cancelled' | 'expired';

export interface SubscriptionTiming {
  endsAt: Date;
  cancelAtPeriodEnd: boolean;
}

// Vigente: ends_at todavía no llegó. Es la misma condición con la que
// ProStatusService calcula isPro en SQL (ends_at > now()).
export function isSubscriptionCurrent(
  subscription: Pick<SubscriptionTiming, 'endsAt'> | null | undefined,
  now: Date,
): boolean {
  return !!subscription && subscription.endsAt.getTime() > now.getTime();
}

// none: sin fila. expired: ends_at <= ahora. cancelled: vigente pero con
// cancelAtPeriodEnd (sigue siendo Pro hasta ends_at). active: el resto.
export function deriveSubscriptionStatus(
  subscription: SubscriptionTiming | null | undefined,
  now: Date,
): SubscriptionStatus {
  if (!subscription) return 'none';
  if (!isSubscriptionCurrent(subscription, now)) return 'expired';
  return subscription.cancelAtPeriodEnd ? 'cancelled' : 'active';
}

// Días que faltan, redondeando hacia arriba (queda 1 mientras falte algo del
// último día). 0 si ya venció.
export function daysRemaining(endsAt: Date, now: Date): number {
  const remaining = endsAt.getTime() - now.getTime();
  return remaining > 0 ? Math.ceil(remaining / DAY_MS) : 0;
}
