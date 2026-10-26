import {
  SUBSCRIPTION_CURRENCY,
  SUBSCRIPTION_PLANS,
  getSubscriptionPlan,
  savingsPercent,
} from './subscription-plans.config';
import { SubscriptionPeriod } from './subscription-period.enum';

describe('catálogo de planes', () => {
  it('cobra en USD con los tres periodos acordados', () => {
    expect(SUBSCRIPTION_CURRENCY).toBe('USD');
    expect(
      SUBSCRIPTION_PLANS.map(({ period, months, price }) => ({
        period,
        months,
        price,
      })),
    ).toEqual([
      { period: 'monthly', months: 1, price: 4.99 },
      { period: 'semiannual', months: 6, price: 24.99 },
      { period: 'annual', months: 12, price: 41.99 },
    ]);
  });

  it('tiene un solo plan por periodo', () => {
    const periods = SUBSCRIPTION_PLANS.map((plan) => plan.period);
    expect(new Set(periods).size).toBe(periods.length);
    expect(periods.sort()).toEqual(Object.values(SubscriptionPeriod).sort());
  });

  it('getSubscriptionPlan devuelve el plan y rechaza un periodo desconocido', () => {
    expect(getSubscriptionPlan(SubscriptionPeriod.ANNUAL).months).toBe(12);
    expect(() => getSubscriptionPlan('weekly' as SubscriptionPeriod)).toThrow(
      'weekly',
    );
  });

  // 24.99 contra 4.99 x 6 = 29.94 -> 16.5 %; 41.99 contra 4.99 x 12 = 59.88
  // -> 29.9 %.
  it('calcula el ahorro contra el precio mensual', () => {
    const percent = (period: SubscriptionPeriod) =>
      savingsPercent(getSubscriptionPlan(period));

    expect(percent(SubscriptionPeriod.MONTHLY)).toBe(0);
    expect(percent(SubscriptionPeriod.SEMIANNUAL)).toBe(17);
    expect(percent(SubscriptionPeriod.ANNUAL)).toBe(30);
  });

  it('el ahorro nunca es negativo', () => {
    expect(
      savingsPercent({
        period: SubscriptionPeriod.SEMIANNUAL,
        months: 6,
        price: 99,
      }),
    ).toBe(0);
  });
});
