import { SubscriptionPeriod } from './subscription-period.enum';

// Catálogo de precios del plan Pro. Es el único lugar donde se definen: para
// cambiar un precio o agregar un periodo basta con editar SUBSCRIPTION_PLANS.
// Se cobra siempre en la moneda del catálogo (USD); la conversión a la moneda
// del usuario es solo informativa.
export const SUBSCRIPTION_CURRENCY = 'USD';

export interface SubscriptionPlan {
  period: SubscriptionPeriod;
  // Meses de calendario que cubre un pago (ver addCalendarMonths).
  months: number;
  // Precio en SUBSCRIPTION_CURRENCY.
  price: number;
}

export const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = [
  { period: SubscriptionPeriod.MONTHLY, months: 1, price: 4.99 },
  { period: SubscriptionPeriod.SEMIANNUAL, months: 6, price: 24.99 },
  { period: SubscriptionPeriod.ANNUAL, months: 12, price: 41.99 },
];

export function getSubscriptionPlan(
  period: SubscriptionPeriod,
): SubscriptionPlan {
  const plan = SUBSCRIPTION_PLANS.find((item) => item.period === period);
  if (!plan) throw new Error(`Periodo de suscripción desconocido: ${period}`);
  return plan;
}

// Ahorro respecto de pagar el plan mensual durante los mismos meses, en
// porcentaje entero (0 para el mensual).
export function savingsPercent(plan: SubscriptionPlan): number {
  const monthly = getSubscriptionPlan(SubscriptionPeriod.MONTHLY);
  const fullPrice = monthly.price * plan.months;
  return Math.max(0, Math.round((1 - plan.price / fullPrice) * 100));
}
