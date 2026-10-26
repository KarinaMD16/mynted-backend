import {
  addCalendarMonths,
  daysRemaining,
  deriveSubscriptionStatus,
  isSubscriptionCurrent,
} from './subscription-dates';

// Costa Rica es UTC-6: 12:00 UTC = 06:00 en Costa Rica.
const at = (iso: string) => new Date(iso);

describe('addCalendarMonths', () => {
  it.each([
    // 2027 no es bisiesto
    ['2027-01-31T18:00:00.000Z', 1, '2027-02-28T18:00:00.000Z'],
    // 2028 sí lo es: 31 de enero + 1 mes = 29 de febrero
    ['2028-01-31T18:00:00.000Z', 1, '2028-02-29T18:00:00.000Z'],
    ['2028-02-29T18:00:00.000Z', 12, '2029-02-28T18:00:00.000Z'],
    ['2028-02-29T18:00:00.000Z', 1, '2028-03-29T18:00:00.000Z'],
    ['2026-08-31T18:00:00.000Z', 6, '2027-02-28T18:00:00.000Z'],
    // el día se conserva si existe en el mes de destino
    ['2026-04-30T18:00:00.000Z', 1, '2026-05-30T18:00:00.000Z'],
    ['2026-03-31T18:00:00.000Z', 1, '2026-04-30T18:00:00.000Z'],
    ['2026-10-15T18:00:00.000Z', 1, '2026-11-15T18:00:00.000Z'],
    // cruce de año
    ['2026-11-30T18:00:00.000Z', 3, '2027-02-28T18:00:00.000Z'],
    ['2026-12-31T18:00:00.000Z', 1, '2027-01-31T18:00:00.000Z'],
    ['2026-10-26T18:00:00.000Z', 12, '2027-10-26T18:00:00.000Z'],
    ['2026-10-26T18:00:00.000Z', 6, '2027-04-26T18:00:00.000Z'],
  ])('%s + %i meses = %s', (start, months, expected) => {
    expect(addCalendarMonths(at(start), months).toISOString()).toBe(expected);
  });

  it('conserva la hora, los minutos y los milisegundos', () => {
    expect(
      addCalendarMonths(at('2026-01-31T18:45:12.345Z'), 1).toISOString(),
    ).toBe('2026-02-28T18:45:12.345Z');
  });

  // 30 de enero 20:00 en Costa Rica es 31 de enero 02:00 en UTC. El día que
  // cuenta es el de Costa Rica: +1 mes = 28 de febrero a las 20:00 (no 27).
  it('calcula el día en la hora de Costa Rica y no en UTC', () => {
    const start = at('2026-01-31T02:00:00.000Z');

    const end = addCalendarMonths(start, 1);

    expect(end.toISOString()).toBe('2026-03-01T02:00:00.000Z');
    // 28 de febrero, 20:00 en Costa Rica
    expect(new Date(end.getTime() - 6 * 3600_000).toISOString()).toBe(
      '2026-02-28T20:00:00.000Z',
    );
  });

  it('un pago a las 23:30 del 31 de enero en Costa Rica (05:30 UTC del 1 de febrero)', () => {
    const start = at('2027-02-01T05:30:00.000Z');

    const end = addCalendarMonths(start, 1);

    // 28 de febrero, 23:30 en Costa Rica = 1 de marzo, 05:30 UTC
    expect(end.toISOString()).toBe('2027-03-01T05:30:00.000Z');
  });

  it('no modifica la fecha recibida', () => {
    const start = at('2026-01-31T18:00:00.000Z');
    addCalendarMonths(start, 1);
    expect(start.toISOString()).toBe('2026-01-31T18:00:00.000Z');
  });
});

describe('vigencia y estado derivado', () => {
  const now = at('2026-10-26T12:00:00.000Z');
  const future = at('2026-11-26T12:00:00.000Z');
  const past = at('2026-10-25T12:00:00.000Z');

  it('es vigente solo si ends_at es posterior a ahora (no si es igual)', () => {
    expect(isSubscriptionCurrent({ endsAt: future }, now)).toBe(true);
    expect(isSubscriptionCurrent({ endsAt: now }, now)).toBe(false);
    expect(isSubscriptionCurrent({ endsAt: past }, now)).toBe(false);
    expect(isSubscriptionCurrent(null, now)).toBe(false);
  });

  it.each([
    ['sin fila', null, 'none'],
    ['vigente', { endsAt: future, cancelAtPeriodEnd: false }, 'active'],
    [
      'vigente y cancelada',
      { endsAt: future, cancelAtPeriodEnd: true },
      'cancelled',
    ],
    ['vencida', { endsAt: past, cancelAtPeriodEnd: false }, 'expired'],
    [
      'vencida y cancelada',
      { endsAt: past, cancelAtPeriodEnd: true },
      'expired',
    ],
    ['justo en ends_at', { endsAt: now, cancelAtPeriodEnd: false }, 'expired'],
  ] as const)('%s -> %s', (_label, subscription, expected) => {
    expect(deriveSubscriptionStatus(subscription, now)).toBe(expected);
  });

  it('daysRemaining redondea hacia arriba y no baja de 0', () => {
    expect(daysRemaining(future, now)).toBe(31);
    expect(daysRemaining(at('2026-10-26T12:00:01.000Z'), now)).toBe(1);
    expect(daysRemaining(at('2026-10-27T12:00:00.000Z'), now)).toBe(1);
    expect(daysRemaining(at('2026-10-27T12:00:01.000Z'), now)).toBe(2);
    expect(daysRemaining(now, now)).toBe(0);
    expect(daysRemaining(past, now)).toBe(0);
  });
});
