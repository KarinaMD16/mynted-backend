import { DataSource } from 'typeorm';
import { ProStatusService } from './pro-status.service';

describe('ProStatusService', () => {
  let service: ProStatusService;
  let query: jest.Mock;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    service = new ProStatusService({ query } as unknown as DataSource);
  });

  it('resuelve un lote con una sola consulta', async () => {
    query.mockResolvedValue([{ user_id: 'u1' }, { user_id: 'u3' }]);

    const pro = await service.proUserIds(['u1', 'u2', 'u3', 'u4']);

    expect(pro).toEqual(new Set(['u1', 'u3']));
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ends_at > now()'),
      [['u1', 'u2', 'u3', 'u4']],
    );
  });

  it('la vigencia se calcula con ends_at, no con un estado guardado', async () => {
    await service.proUserIds(['u1']);

    const [sql] = query.mock.calls[0] as [string];
    expect(sql).toContain('ends_at > now()');
    expect(sql).not.toMatch(/status/i);
  });

  it('quita los ids repetidos antes de consultar', async () => {
    await service.proUserIds(['u1', 'u1', 'u2', 'u1']);

    expect(query).toHaveBeenCalledWith(expect.any(String), [['u1', 'u2']]);
  });

  it('acepta cualquier iterable', async () => {
    query.mockResolvedValue([{ user_id: 'u2' }]);

    const pro = await service.proUserIds(new Set(['u1', 'u2']));

    expect(pro).toEqual(new Set(['u2']));
  });

  it('sin ids no consulta', async () => {
    await expect(service.proUserIds([])).resolves.toEqual(new Set());
    expect(query).not.toHaveBeenCalled();
  });

  it('isPro es true solo si el usuario está en el lote vigente', async () => {
    query.mockResolvedValueOnce([{ user_id: 'u1' }]);
    await expect(service.isPro('u1')).resolves.toBe(true);

    query.mockResolvedValueOnce([]);
    await expect(service.isPro('u1')).resolves.toBe(false);
  });
});
