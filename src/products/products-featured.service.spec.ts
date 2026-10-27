import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { Product, ProductStatus } from './entities/product.entity';
import { MAX_FEATURED_PER_SELLER } from './featured-products';
import { ProductsService } from './products.service';

const OWNER = 'owner-user';
const SELLER_ID = 7;
const FEATURED_AT = new Date('2026-10-20T12:00:00.000Z');

interface Harness {
  service: ProductsService;
  productRepository: { findOne: jest.Mock };
  sellerRepository: { findOne: jest.Mock };
  proStatusService: { isPro: jest.Mock };
  dataSource: { query: jest.Mock; transaction: jest.Mock };
  manager: { query: jest.Mock };
}

function createHarness(): Harness {
  const productRepository = { findOne: jest.fn() };
  const sellerRepository = { findOne: jest.fn() };
  const proStatusService = { isPro: jest.fn().mockResolvedValue(true) };
  const manager = { query: jest.fn() };
  const dataSource = {
    query: jest.fn().mockResolvedValue([]),
    transaction: jest.fn((callback: (m: typeof manager) => unknown) =>
      Promise.resolve(callback(manager)),
    ),
  };
  const repo = {} as Repository<never>;

  const service = new ProductsService(
    productRepository as unknown as Repository<Product>,
    sellerRepository as never,
    repo,
    repo,
    repo,
    repo,
    repo,
    repo,
    {} as never,
    {} as never,
    {} as never,
    dataSource as never,
    {} as never,
    proStatusService as never,
    {} as never,
  );
  return {
    service,
    productRepository,
    sellerRepository,
    proStatusService,
    dataSource,
    manager,
  };
}

const ownProduct = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  status: ProductStatus.ACTIVE,
  sellerId: SELLER_ID,
  featuredAt: null,
  seller: { sellerId: SELLER_ID, userId: OWNER, isVerified: true },
  ...overrides,
});

describe('ProductsService: destacados (marcar, quitar, resumen)', () => {
  describe('setFeatured', () => {
    it('404 si el producto no existe', async () => {
      const h = createHarness();
      h.productRepository.findOne.mockResolvedValue(null);

      await expect(h.service.setFeatured(42, OWNER)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404 (no 403) si es de otro vendedor: no se revela que existe', async () => {
      const h = createHarness();
      h.productRepository.findOne.mockResolvedValue(
        ownProduct({
          seller: { sellerId: 9, userId: 'otro', isVerified: true },
        }),
      );

      await expect(h.service.setFeatured(42, OWNER)).rejects.toThrow(
        new NotFoundException('Producto no encontrado'),
      );
      expect(h.dataSource.transaction).not.toHaveBeenCalled();
    });

    it('pide a la base la preferencia, que no se carga por defecto', async () => {
      const h = createHarness();
      h.productRepository.findOne.mockResolvedValue(null);

      await h.service.setFeatured(42, OWNER).catch(() => null);

      expect(h.productRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({ featuredAt: true }) as unknown,
        }),
      );
    });

    it('403 si el vendedor no está aprobado', async () => {
      const h = createHarness();
      h.productRepository.findOne.mockResolvedValue(
        ownProduct({
          seller: { sellerId: SELLER_ID, userId: OWNER, isVerified: false },
        }),
      );

      await expect(h.service.setFeatured(42, OWNER)).rejects.toThrow(
        new ForbiddenException('Requiere ser un vendedor aprobado'),
      );
    });

    it('403 si no tiene Pro vigente', async () => {
      const h = createHarness();
      h.productRepository.findOne.mockResolvedValue(ownProduct());
      h.proStatusService.isPro.mockResolvedValue(false);

      await expect(h.service.setFeatured(42, OWNER)).rejects.toThrow(
        ForbiddenException,
      );
      expect(h.proStatusService.isPro).toHaveBeenCalledWith(OWNER);
      expect(h.dataSource.transaction).not.toHaveBeenCalled();
    });

    it.each([ProductStatus.DRAFT, ProductStatus.INACTIVE, ProductStatus.SOLD])(
      '409 si el producto está %s',
      async (status) => {
        const h = createHarness();
        h.productRepository.findOne.mockResolvedValue(ownProduct({ status }));

        await expect(h.service.setFeatured(42, OWNER)).rejects.toThrow(
          new ConflictException('Solo se pueden destacar productos activos'),
        );
        expect(h.dataSource.transaction).not.toHaveBeenCalled();
      },
    );

    it('409 si ya tiene el tope de destacados efectivos', async () => {
      const h = createHarness();
      h.productRepository.findOne.mockResolvedValue(ownProduct());
      h.manager.query
        .mockResolvedValueOnce([]) // candado
        .mockResolvedValueOnce([{ count: MAX_FEATURED_PER_SELLER }]);

      await expect(h.service.setFeatured(42, OWNER)).rejects.toThrow(
        new ConflictException(
          'Ya tienes 3 productos destacados. Quita uno para destacar otro',
        ),
      );
      // No intentó marcarlo.
      expect(h.manager.query).toHaveBeenCalledTimes(2);
    });

    it('serializa por vendedor con un candado y cuenta solo los efectivos de ese vendedor', async () => {
      const h = createHarness();
      h.productRepository.findOne.mockResolvedValue(ownProduct());
      h.manager.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 2 }])
        .mockResolvedValueOnce([{ featured_at: FEATURED_AT }]);
      h.dataSource.query.mockResolvedValue([{ id: 42 }]);

      await h.service.setFeatured(42, OWNER);

      const [lockSql, lockParams] = h.manager.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(lockSql).toContain('pg_advisory_xact_lock');
      expect(lockParams).toEqual(['featured', SELLER_ID]);
      const [countSql, countParams] = h.manager.query.mock.calls[1] as [
        string,
        unknown[],
      ];
      expect(countSql).toContain('product.featured_at IS NOT NULL');
      expect(countSql).toContain('product_sub.ends_at > now()');
      expect(countParams).toEqual([SELLER_ID]);
    });

    it('con cupo lo marca y responde la preferencia y si se eleva ahora', async () => {
      const h = createHarness();
      h.productRepository.findOne.mockResolvedValue(ownProduct());
      h.manager.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 2 }])
        .mockResolvedValueOnce([{ featured_at: FEATURED_AT }]);
      h.dataSource.query.mockResolvedValue([{ id: 42 }]);

      await expect(h.service.setFeatured(42, OWNER)).resolves.toEqual({
        productId: 42,
        featuredEnabled: true,
        isFeatured: true,
        featuredAt: FEATURED_AT,
      });

      const [updateSql] = h.manager.query.mock.calls[2] as [string];
      expect(updateSql).toContain('featured_at IS NULL');
    });

    it('marcado pero sin elevarse (p. ej. comunidad privada): featuredEnabled true e isFeatured false', async () => {
      const h = createHarness();
      h.productRepository.findOne.mockResolvedValue(ownProduct());
      h.manager.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([{ featured_at: FEATURED_AT }]);
      h.dataSource.query.mockResolvedValue([]);

      await expect(h.service.setFeatured(42, OWNER)).resolves.toMatchObject({
        featuredEnabled: true,
        isFeatured: false,
      });
    });

    it('si otra petición lo marcó entre medias conserva su fecha', async () => {
      const h = createHarness();
      h.productRepository.findOne.mockResolvedValue(ownProduct());
      h.manager.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([]) // el UPDATE ya no encontró featured_at nulo
        .mockResolvedValueOnce([{ featured_at: FEATURED_AT }]);

      await expect(h.service.setFeatured(42, OWNER)).resolves.toMatchObject({
        featuredAt: FEATURED_AT,
      });
    });

    it('es idempotente: ya destacado responde igual sin transacción ni cambiar la fecha', async () => {
      const h = createHarness();
      h.productRepository.findOne.mockResolvedValue(
        ownProduct({ featuredAt: FEATURED_AT }),
      );
      h.dataSource.query.mockResolvedValue([{ id: 42 }]);

      await expect(h.service.setFeatured(42, OWNER)).resolves.toEqual({
        productId: 42,
        featuredEnabled: true,
        isFeatured: true,
        featuredAt: FEATURED_AT,
      });

      expect(h.dataSource.transaction).not.toHaveBeenCalled();
    });

    it('ya destacado y sin tope disponible no falla: no cuenta dos veces', async () => {
      const h = createHarness();
      h.productRepository.findOne.mockResolvedValue(
        ownProduct({ featuredAt: FEATURED_AT, status: ProductStatus.SOLD }),
      );

      await expect(h.service.setFeatured(42, OWNER)).resolves.toMatchObject({
        featuredEnabled: true,
        isFeatured: false,
      });
    });

    it('ya destacado, pero sin Pro vigente sigue siendo 403 (marcar exige Pro)', async () => {
      const h = createHarness();
      h.productRepository.findOne.mockResolvedValue(
        ownProduct({ featuredAt: FEATURED_AT }),
      );
      h.proStatusService.isPro.mockResolvedValue(false);

      await expect(h.service.setFeatured(42, OWNER)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('unsetFeatured', () => {
    it('404 si no existe o no es suyo', async () => {
      const h = createHarness();
      h.productRepository.findOne.mockResolvedValue(null);
      await expect(h.service.unsetFeatured(42, OWNER)).rejects.toThrow(
        NotFoundException,
      );

      h.productRepository.findOne.mockResolvedValue(
        ownProduct({
          seller: { sellerId: 9, userId: 'otro', isVerified: true },
        }),
      );
      await expect(h.service.unsetFeatured(42, OWNER)).rejects.toThrow(
        NotFoundException,
      );
      expect(h.dataSource.query).not.toHaveBeenCalled();
    });

    it('limpia featured_at del producto, sin exigir Pro', async () => {
      const h = createHarness();
      h.productRepository.findOne.mockResolvedValue(
        ownProduct({ featuredAt: FEATURED_AT }),
      );
      h.proStatusService.isPro.mockResolvedValue(false);

      await expect(h.service.unsetFeatured(42, OWNER)).resolves.toBeUndefined();

      expect(h.dataSource.query).toHaveBeenCalledWith(
        'UPDATE product SET featured_at = NULL WHERE id = $1',
        [42],
      );
      expect(h.proStatusService.isPro).not.toHaveBeenCalled();
    });

    it('es idempotente: sin destacado previo también termina bien', async () => {
      const h = createHarness();
      h.productRepository.findOne.mockResolvedValue(ownProduct());

      await expect(h.service.unsetFeatured(42, OWNER)).resolves.toBeUndefined();
    });
  });

  describe('getFeaturedSummary', () => {
    it.each([
      [0, { limit: 3, used: 0, remaining: 3 }],
      [2, { limit: 3, used: 2, remaining: 1 }],
      [3, { limit: 3, used: 3, remaining: 0 }],
      // Más efectivos que el tope (reactivados): se muestra el tope.
      [5, { limit: 3, used: 3, remaining: 0 }],
    ])('con %i efectivos', async (count, expected) => {
      const h = createHarness();
      h.sellerRepository.findOne.mockResolvedValue({ sellerId: SELLER_ID });
      h.dataSource.query.mockResolvedValue([{ count }]);

      await expect(h.service.getFeaturedSummary(OWNER)).resolves.toEqual(
        expected,
      );
    });

    it('cuenta con el recorte al tope y solo los del vendedor', async () => {
      const h = createHarness();
      h.sellerRepository.findOne.mockResolvedValue({ sellerId: SELLER_ID });
      h.dataSource.query.mockResolvedValue([{ count: 1 }]);

      await h.service.getFeaturedSummary(OWNER);

      const [sql, params] = h.dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('ROW_NUMBER()');
      expect(params).toEqual([SELLER_ID]);
    });

    it('403 si no es vendedor', async () => {
      const h = createHarness();
      h.sellerRepository.findOne.mockResolvedValue(null);

      await expect(h.service.getFeaturedSummary(OWNER)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('findEffectiveFeaturedIds', () => {
    it('una sola consulta para toda la lista y vacío sin consultar', async () => {
      const h = createHarness();
      h.dataSource.query.mockResolvedValue([{ id: 1 }, { id: 3 }]);

      await expect(
        h.service.findEffectiveFeaturedIds([1, 2, 3]),
      ).resolves.toEqual(new Set([1, 3]));
      expect(h.dataSource.query).toHaveBeenCalledTimes(1);
      expect((h.dataSource.query.mock.calls as unknown[][])[0][1]).toEqual([
        [1, 2, 3],
      ]);

      h.dataSource.query.mockClear();
      await expect(h.service.findEffectiveFeaturedIds([])).resolves.toEqual(
        new Set(),
      );
      expect(h.dataSource.query).not.toHaveBeenCalled();
    });
  });
});
