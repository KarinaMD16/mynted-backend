import { DataSource } from 'typeorm';
import { ResponseTimeService } from './response-time.service';

describe('ResponseTimeService', () => {
  let service: ResponseTimeService;
  let query: jest.Mock;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([
      { user_id: 'fast', median_minutes: 19.6, sample_size: 5 },
      // percentile_cont puede llegar como string (numeric).
      { user_id: 'string', median_minutes: '42.4', sample_size: 3 },
      { user_id: 'few', median_minutes: 5, sample_size: 2 },
    ]);
    service = new ResponseTimeService({ query } as unknown as DataSource);
  });

  it('devuelve la mediana redondeada y la muestra con 3 o más conversaciones respondidas', async () => {
    const result = await service.getForUsers(['fast', 'string']);

    expect(result.get('fast')).toEqual({ medianMinutes: 20, sampleSize: 5 });
    expect(result.get('string')).toEqual({ medianMinutes: 42, sampleSize: 3 });
  });

  it('null con menos de 3 conversaciones respondidas o sin ninguna', async () => {
    const result = await service.getForUsers(['few', 'none']);

    expect(result.get('few')).toBeNull();
    expect(result.get('none')).toBeNull();
  });

  it('una sola consulta por lote, con la ventana de 90 días', async () => {
    await service.getForUsers(['fast', 'few', 'fast']);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ANY($1'), [
      ['fast', 'few'],
      90,
    ]);
  });

  it('usa la caché: solo consulta los vendedores que no tiene', async () => {
    await service.getForUsers(['fast']);
    await expect(service.getForUser('fast')).resolves.toEqual({
      medianMinutes: 20,
      sampleSize: 5,
    });
    expect(query).toHaveBeenCalledTimes(1);

    await service.getForUsers(['fast', 'few']);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [['few'], 90]);
  });

  it('la caché vence a los 10 minutos', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await service.getForUser('fast');

    now.mockReturnValue(1_000_000 + 10 * 60_000 + 1);
    await service.getForUser('fast');

    expect(query).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('cache también el null (no reconsulta a un vendedor sin muestra)', async () => {
    await service.getForUser('none');
    await service.getForUser('none');

    expect(query).toHaveBeenCalledTimes(1);
  });
});
