import { DataSource } from 'typeorm';
import { NotificationsRetentionService } from './notifications-retention.service';

describe('NotificationsRetentionService', () => {
  it('repite los lotes hasta que uno sale incompleto', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([{ count: 1 }]);
    const service = new NotificationsRetentionService({
      query,
    } as unknown as DataSource);

    await expect(service.purgeExpired(2)).resolves.toBe(5);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenCalledWith(expect.any(String), [90, 180, 2]);
  });

  it('el cron loguea el error y no lo propaga', async () => {
    const service = new NotificationsRetentionService({
      query: jest.fn().mockRejectedValue(new Error('db caída')),
    } as unknown as DataSource);
    const logger = jest
      .spyOn(
        (service as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    await expect(service.runRetentionCron()).resolves.toBeUndefined();
    expect(logger).toHaveBeenCalled();
  });
});
