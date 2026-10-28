import { DataSource } from 'typeorm';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import {
  expiredNotification,
  expiringSoonNotification,
  paymentConfirmedNotification,
} from './subscription-notifications';
import { SubscriptionPeriod } from './subscription-period.enum';
import {
  EXPIRED_NOTICE_MAX_AGE_DAYS,
  EXPIRING_NOTICE_DAYS,
  SubscriptionsCronService,
} from './subscriptions-cron.service';

const NOW = new Date('2026-10-26T08:00:00.000Z');

const row = (overrides: Record<string, unknown> = {}) => ({
  subscriptionId: 'sub-1',
  userId: 'user-1',
  period: SubscriptionPeriod.MONTHLY,
  endsAt: new Date('2026-10-28T08:00:00.000Z'),
  cancelAtPeriodEnd: false,
  ...overrides,
});

describe('SubscriptionsCronService', () => {
  let query: jest.Mock;
  let notify: jest.Mock;
  let service: SubscriptionsCronService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    query = jest.fn().mockResolvedValue([]);
    notify = jest.fn().mockResolvedValue([]);
    service = new SubscriptionsCronService(
      { query } as unknown as DataSource,
      { notify } as unknown as NotificationsService,
    );
  });
  afterEach(() => jest.useRealTimers());

  it('corre a las 2 AM de Costa Rica', () => {
    const options = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      Object.getOwnPropertyDescriptor(
        SubscriptionsCronService.prototype,
        'runDailyCron',
      )?.value as object,
    ) as { cronTime: string; timeZone: string };

    expect(options).toMatchObject({
      cronTime: '0 0 2 * * *',
      timeZone: 'America/Costa_Rica',
    });
  });

  describe('por vencer', () => {
    it('reclama con un UPDATE atómico sobre el marcador y avisa a quienes reclamó', async () => {
      query.mockResolvedValueOnce([
        row(),
        row({
          subscriptionId: 'sub-2',
          userId: 'user-2',
          cancelAtPeriodEnd: true,
        }),
      ]);

      await expect(service.notifyExpiring()).resolves.toBe(2);

      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('expiring_notified_for IS DISTINCT FROM s.ends_at');
      expect(sql).toContain('SET expiring_notified_for = s.ends_at');
      expect(sql).toContain('FOR UPDATE OF s SKIP LOCKED');
      expect(sql).toContain('u.is_active = true');
      expect(sql).toContain('RETURNING');
      expect(params).toEqual([EXPIRING_NOTICE_DAYS]);
      expect(notify).toHaveBeenCalledTimes(1);
      const inputs = (notify.mock.calls as [unknown[]][])[0][0] as {
        userId: string;
        type: NotificationType;
        data: Record<string, unknown>;
      }[];
      expect(inputs.map((input) => input.userId)).toEqual(['user-1', 'user-2']);
      expect(inputs[0].type).toBe('subscription_expiring_soon');
      expect(inputs[0].data).toMatchObject({
        subscriptionId: 'sub-1',
        period: 'monthly',
        daysRemaining: 2,
        cancelAtPeriodEnd: false,
      });
      expect(inputs[1].data).toMatchObject({ cancelAtPeriodEnd: true });
    });

    it('sin filas pendientes no notifica', async () => {
      await expect(service.notifyExpiring()).resolves.toBe(0);
      expect(notify).not.toHaveBeenCalled();
    });

    it('procesa por lotes hasta que uno viene incompleto', async () => {
      const full = Array.from({ length: 200 }, (_, index) =>
        row({ subscriptionId: `sub-${index}`, userId: `user-${index}` }),
      );
      query
        .mockResolvedValueOnce(full)
        .mockResolvedValueOnce([row({ subscriptionId: 'last' })]);

      await expect(service.notifyExpiring()).resolves.toBe(201);

      expect(query).toHaveBeenCalledTimes(2);
      expect(notify).toHaveBeenCalledTimes(2);
    });

    it('si falla el envío devuelve el reclamo para reintentar y propaga el error', async () => {
      query.mockResolvedValueOnce([row(), row({ subscriptionId: 'sub-2' })]);
      notify.mockRejectedValueOnce(new Error('db caída'));

      await expect(service.notifyExpiring()).rejects.toThrow('db caída');

      const [sql, params] = query.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('SET expiring_notified_for = NULL');
      expect(sql).toContain('expiring_notified_for = ends_at');
      expect(params).toEqual([['sub-1', 'sub-2']]);
    });
  });

  describe('vencidas', () => {
    it('reclama con su propio marcador y solo los vencimientos recientes', async () => {
      query.mockResolvedValueOnce([
        row({ endsAt: new Date('2026-10-26T01:00:00Z') }),
      ]);

      await expect(service.notifyExpired()).resolves.toBe(1);

      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('SET expired_notified_for = s.ends_at');
      expect(sql).toContain('expired_notified_for IS DISTINCT FROM s.ends_at');
      expect(sql).toContain('s.ends_at <= now()');
      expect(params).toEqual([EXPIRED_NOTICE_MAX_AGE_DAYS]);
      const [input] = (notify.mock.calls as [unknown[]][])[0][0] as {
        type: string;
      }[];
      expect(input.type).toBe('subscription_expired');
    });

    it('si falla el envío libera solo el marcador de vencidas', async () => {
      query.mockResolvedValueOnce([row()]);
      notify.mockRejectedValueOnce(new Error('boom'));

      await expect(service.notifyExpired()).rejects.toThrow('boom');

      const [sql] = query.mock.calls[1] as [string];
      expect(sql).toContain('SET expired_notified_for = NULL');
    });
  });

  describe('runDailyCron', () => {
    it('avisa por vencer y vencidas en una corrida', async () => {
      query
        .mockResolvedValueOnce([row()])
        .mockResolvedValueOnce([row({ subscriptionId: 'sub-9' })]);

      await expect(service.runOnce()).resolves.toEqual({
        expiring: 1,
        expired: 1,
      });
    });

    it('nunca rompe el proceso: un error se registra y no se propaga', async () => {
      query.mockRejectedValue(new Error('sin conexión'));

      await expect(service.runDailyCron()).resolves.toBeUndefined();
    });
  });
});

describe('textos y data de las notificaciones de suscripción', () => {
  it('por vencer: incluye cancelAtPeriodEnd y adapta el texto', () => {
    const renews = expiringSoonNotification(row(), NOW);
    const cancelled = expiringSoonNotification(
      row({ cancelAtPeriodEnd: true }),
      NOW,
    );

    expect(renews.message).toContain('Renuévalo');
    expect(cancelled.message).toContain('Cancelaste la renovación');
    expect(cancelled.data.cancelAtPeriodEnd).toBe(true);
    expect(renews.dedupeKey).toBe(
      'subscription_expiring_soon:sub-1:2026-10-28T08:00:00.000Z',
    );
  });

  it('vencida: data mínima y clave propia', () => {
    const notification = expiredNotification(row());

    expect(notification).toMatchObject({
      userId: 'user-1',
      type: 'subscription_expired',
      data: { subscriptionId: 'sub-1', period: 'monthly' },
      dedupeKey: 'subscription_expired:sub-1:2026-10-28T08:00:00.000Z',
    });
  });

  it('pago confirmado: lleva el pago, el periodo y el nuevo vencimiento', () => {
    const endsAt = new Date('2026-11-26T18:00:00.000Z');

    const notification = paymentConfirmedNotification({
      paymentId: 'pay-1',
      userId: 'user-1',
      period: SubscriptionPeriod.ANNUAL,
      amount: 41.99,
      currency: 'USD',
      startsAt: NOW,
      endsAt,
      renewal: true,
    });

    expect(notification).toMatchObject({
      userId: 'user-1',
      type: 'subscription_payment_confirmed',
      data: {
        paymentId: 'pay-1',
        period: 'annual',
        amount: 41.99,
        currency: 'USD',
        endsAt,
        renewal: true,
      },
      dedupeKey: 'subscription_payment_confirmed:pay-1',
    });
    expect(notification.message).toContain('noviembre');
  });
});
