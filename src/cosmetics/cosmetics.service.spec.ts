import { Repository } from 'typeorm';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { ProStatusService } from '../pro-status/pro-status.service';
import { CosmeticsService } from './cosmetics.service';
import { Cosmetic, CosmeticType } from './entities/cosmetic.entity';
import { UserCosmetics } from './entities/user-cosmetics.entity';

const row = (
  id: number,
  code: string,
  type: CosmeticType,
  overrides: Partial<Cosmetic> = {},
): Cosmetic => ({
  id,
  code,
  type,
  name: code,
  assetUrl: null,
  proOnly: false,
  isDefault: false,
  sortOrder: 0,
  isActive: true,
  ...overrides,
});

const catalog = (): Cosmetic[] => [
  row(1, 'banner_default', CosmeticType.BANNER, { isDefault: true }),
  row(10, 'goose_default', CosmeticType.GOOSE_SKIN, { isDefault: true }),
  row(20, 'frame_default', CosmeticType.FRAME, {
    isDefault: true,
    assetUrl: 'https://cdn/frames/default.png',
  }),
  row(21, 'frame_simple', CosmeticType.FRAME, {
    assetUrl: 'https://cdn/frames/simple.png',
  }),
  row(22, 'frame_gold', CosmeticType.FRAME, {
    proOnly: true,
    assetUrl: 'https://cdn/frames/gold.png',
  }),
  row(23, 'frame_neon', CosmeticType.FRAME, { proOnly: true }),
];

const prefs = (userId: string, frameCosmeticId: number | null) =>
  ({ userId, frameCosmeticId }) as UserCosmetics;

describe('CosmeticsService: cargador por lotes (resumen liviano)', () => {
  let cosmeticRepository: { find: jest.Mock };
  let userCosmeticsRepository: { find: jest.Mock };
  let proStatusService: { proUserIds: jest.Mock };
  let service: CosmeticsService;

  const totalQueries = () =>
    cosmeticRepository.find.mock.calls.length +
    userCosmeticsRepository.find.mock.calls.length +
    proStatusService.proUserIds.mock.calls.length;

  beforeEach(() => {
    delete process.env.COSMETICS_CATALOG_CACHE_TTL_MS;
    cosmeticRepository = { find: jest.fn().mockResolvedValue(catalog()) };
    userCosmeticsRepository = { find: jest.fn().mockResolvedValue([]) };
    proStatusService = {
      proUserIds: jest.fn().mockResolvedValue(new Set<string>()),
    };
    service = new CosmeticsService(
      cosmeticRepository as unknown as Repository<Cosmetic>,
      userCosmeticsRepository as unknown as Repository<UserCosmetics>,
      proStatusService as unknown as ProStatusService,
      {} as CloudinaryService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.COSMETICS_CATALOG_CACHE_TTL_MS;
  });

  describe('getEffectiveSummaryForUsers', () => {
    it('un usuario Pro con un marco Pro equipado: isPro true y ese marco', async () => {
      proStatusService.proUserIds.mockResolvedValue(new Set(['u1']));
      userCosmeticsRepository.find.mockResolvedValue([prefs('u1', 22)]);

      const result = await service.getEffectiveSummaryForUsers(['u1']);

      expect(result.get('u1')).toEqual({
        isPro: true,
        frame: { code: 'frame_gold', assetUrl: 'https://cdn/frames/gold.png' },
      });
    });

    it('Pro vencido: el marco Pro equipado vuelve al marco por defecto (la preferencia no se toca)', async () => {
      userCosmeticsRepository.find.mockResolvedValue([prefs('u1', 22)]);

      const result = await service.getEffectiveSummaryForUsers(['u1']);

      expect(result.get('u1')).toEqual({
        isPro: false,
        frame: {
          code: 'frame_default',
          assetUrl: 'https://cdn/frames/default.png',
        },
      });
    });

    it('un usuario gratuito con un marco gratuito equipado lo conserva', async () => {
      userCosmeticsRepository.find.mockResolvedValue([prefs('u1', 21)]);

      const result = await service.getEffectiveSummaryForUsers(['u1']);

      expect(result.get('u1')).toEqual({
        isPro: false,
        frame: {
          code: 'frame_simple',
          assetUrl: 'https://cdn/frames/simple.png',
        },
      });
    });

    it('sin fila de preferencias, o sin marco elegido, recibe el marco por defecto', async () => {
      proStatusService.proUserIds.mockResolvedValue(new Set(['pro']));
      userCosmeticsRepository.find.mockResolvedValue([prefs('sinmarco', null)]);

      const result = await service.getEffectiveSummaryForUsers([
        'sinpreferencias',
        'sinmarco',
        'pro',
      ]);

      expect(result.get('sinpreferencias')).toEqual({
        isPro: false,
        frame: expect.objectContaining({ code: 'frame_default' }) as unknown,
      });
      expect(result.get('sinmarco')?.frame.code).toBe('frame_default');
      expect(result.get('pro')).toMatchObject({
        isPro: true,
        frame: { code: 'frame_default' },
      });
    });

    it('un marco desactivado en el catálogo o que ya no existe cae al por defecto', async () => {
      cosmeticRepository.find.mockResolvedValue([
        ...catalog().filter((cosmetic) => cosmetic.id !== 21),
        row(21, 'frame_simple', CosmeticType.FRAME, { isActive: false }),
      ]);
      userCosmeticsRepository.find.mockResolvedValue([
        prefs('inactivo', 21),
        prefs('borrado', 999),
      ]);

      const result = await service.getEffectiveSummaryForUsers([
        'inactivo',
        'borrado',
      ]);

      expect(result.get('inactivo')?.frame.code).toBe('frame_default');
      expect(result.get('borrado')?.frame.code).toBe('frame_default');
    });

    it('un lote con ids repetidos y vacíos devuelve una entrada por usuario y consulta con ids únicos', async () => {
      proStatusService.proUserIds.mockResolvedValue(new Set(['u2']));
      userCosmeticsRepository.find.mockResolvedValue([
        prefs('u1', 21),
        prefs('u2', 22),
      ]);

      const result = await service.getEffectiveSummaryForUsers([
        'u1',
        'u2',
        'u1',
        '',
        'u2',
        undefined as unknown as string,
      ]);

      expect([...result.keys()]).toEqual(['u1', 'u2']);
      expect(proStatusService.proUserIds).toHaveBeenCalledWith(['u1', 'u2']);
      expect(result.get('u1')?.frame.code).toBe('frame_simple');
      expect(result.get('u2')?.frame.code).toBe('frame_gold');
    });

    it('un usuario que no existe no rompe nada: Map con el marco por defecto', async () => {
      await expect(
        service.getEffectiveSummaryForUsers(['fantasma']),
      ).resolves.toEqual(
        new Map([
          [
            'fantasma',
            {
              isPro: false,
              frame: {
                code: 'frame_default',
                assetUrl: 'https://cdn/frames/default.png',
              },
            },
          ],
        ]),
      );
    });

    it('una lista vacía no consulta nada', async () => {
      await expect(service.getEffectiveSummaryForUsers([])).resolves.toEqual(
        new Map(),
      );
      await expect(
        service.getEffectiveSummaryForUsers([
          '',
          undefined as unknown as string,
        ]),
      ).resolves.toEqual(new Map());

      expect(totalQueries()).toBe(0);
    });

    it('sin catálogo sembrado usa un marco neutro en vez de fallar', async () => {
      cosmeticRepository.find.mockResolvedValue([]);

      const result = await service.getEffectiveSummaryForUsers(['u1']);

      expect(result.get('u1')).toEqual({
        isPro: false,
        frame: { code: 'frame_default', assetUrl: null },
      });
    });

    it('solo pide la columna del marco de las preferencias', async () => {
      await service.getEffectiveSummaryForUsers(['u1']);

      expect(userCosmeticsRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { userId: true, frameCosmeticId: true },
        }),
      );
    });
  });

  describe('número de consultas', () => {
    it('la primera resolución hace 3 consultas (Pro, preferencias, catálogo), sea cual sea el tamaño de la lista', async () => {
      const ids = Array.from({ length: 200 }, (_, i) => `user-${i}`);

      await service.getEffectiveSummaryForUsers(ids);

      expect(proStatusService.proUserIds).toHaveBeenCalledTimes(1);
      expect(userCosmeticsRepository.find).toHaveBeenCalledTimes(1);
      expect(cosmeticRepository.find).toHaveBeenCalledTimes(1);
      expect(totalQueries()).toBe(3);
    });

    it('con el catálogo en caché solo hace 2 consultas', async () => {
      await service.getEffectiveSummaryForUsers(['u1']);
      cosmeticRepository.find.mockClear();
      userCosmeticsRepository.find.mockClear();
      proStatusService.proUserIds.mockClear();

      await service.getEffectiveSummaryForUsers(['u2', 'u3']);

      expect(cosmeticRepository.find).not.toHaveBeenCalled();
      expect(totalQueries()).toBe(2);
    });

    it('el catálogo se cachea unos 60 s y después se vuelve a consultar', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-26T12:00:00Z'));
      await service.getEffectiveSummaryForUsers(['u1']);

      jest.setSystemTime(new Date('2026-10-26T12:00:59Z'));
      await service.getEffectiveSummaryForUsers(['u1']);
      expect(cosmeticRepository.find).toHaveBeenCalledTimes(1);

      jest.setSystemTime(new Date('2026-10-26T12:01:01Z'));
      await service.getEffectiveSummaryForUsers(['u1']);
      expect(cosmeticRepository.find).toHaveBeenCalledTimes(2);
    });

    it('clearCatalogCache fuerza una nueva lectura', async () => {
      await service.getEffectiveSummaryForUsers(['u1']);

      service.clearCatalogCache();
      await service.getEffectiveSummaryForUsers(['u1']);

      expect(cosmeticRepository.find).toHaveBeenCalledTimes(2);
    });

    it('COSMETICS_CATALOG_CACHE_TTL_MS=0 desactiva la caché', async () => {
      process.env.COSMETICS_CATALOG_CACHE_TTL_MS = '0';

      await service.getEffectiveSummaryForUsers(['u1']);
      await service.getEffectiveSummaryForUsers(['u1']);

      expect(cosmeticRepository.find).toHaveBeenCalledTimes(2);
    });

    it('un cambio en el catálogo se ve al vencer la caché', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-26T12:00:00Z'));
      userCosmeticsRepository.find.mockResolvedValue([prefs('u1', 21)]);
      expect(
        (await service.getEffectiveSummaryForUsers(['u1'])).get('u1')?.frame
          .code,
      ).toBe('frame_simple');

      cosmeticRepository.find.mockResolvedValue(
        catalog().map((cosmetic) =>
          cosmetic.id === 21 ? { ...cosmetic, isActive: false } : cosmetic,
        ),
      );
      // Aún en caché.
      expect(
        (await service.getEffectiveSummaryForUsers(['u1'])).get('u1')?.frame
          .code,
      ).toBe('frame_simple');

      jest.setSystemTime(new Date('2026-10-26T12:02:00Z'));
      expect(
        (await service.getEffectiveSummaryForUsers(['u1'])).get('u1')?.frame
          .code,
      ).toBe('frame_default');
    });
  });

  describe('getEffectiveCosmeticsForUsers (perfil y tienda)', () => {
    it('devuelve isPro y los cosméticos completos con la misma resolución y el mismo marco', async () => {
      proStatusService.proUserIds.mockResolvedValue(new Set(['u1']));
      userCosmeticsRepository.find.mockResolvedValue([
        { userId: 'u1', frameCosmeticId: 22 } as UserCosmetics,
        { userId: 'u2', frameCosmeticId: 22 } as UserCosmetics,
      ]);

      const full = await service.getEffectiveCosmeticsForUsers(['u1', 'u2']);
      const summary = await service.getEffectiveSummaryForUsers(['u1', 'u2']);

      expect(full.get('u1')).toMatchObject({
        isPro: true,
        cosmetics: {
          banner: { source: 'default' },
          frame: { code: 'frame_gold' },
        },
      });
      expect(full.get('u2')?.cosmetics.frame.code).toBe('frame_default');
      for (const id of ['u1', 'u2']) {
        expect(full.get(id)?.cosmetics.frame).toEqual(summary.get(id)?.frame);
        expect(full.get(id)?.isPro).toBe(summary.get(id)?.isPro);
      }
    });

    it('es una resolución de 3 consultas por lista', async () => {
      await service.getEffectiveCosmeticsForUsers(['u1', 'u2', 'u3']);

      expect(totalQueries()).toBe(3);
    });

    it('ids vacíos no consultan', async () => {
      await expect(service.getEffectiveCosmeticsForUsers([])).resolves.toEqual(
        new Map(),
      );
      expect(totalQueries()).toBe(0);
    });
  });
});
