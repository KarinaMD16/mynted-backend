import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { UserBadge } from '../badges/entities/user-badge.entity';
import { ProductSort } from '../products/dto/product-price-query.dto';
import { ProductStatus } from '../products/entities/product.entity';
import { ProductsService } from '../products/products.service';
import { CosmeticsService } from '../cosmetics/cosmetics.service';
import { ResponseTimeService } from '../response-time/response-time.service';
import { Seller } from '../sellers/entities/seller.entity';
import { UsersService } from '../users/users.service';
import { GetSellerProductsQueryDto } from './dto/get-seller-products-query.dto';
import { SellersPublicService } from './sellers-public.service';

const DEFAULT_COSMETICS = {
  banner: {
    source: 'default',
    code: 'banner_default',
    url: null,
    staticUrl: null,
    isAnimated: false,
  },
  gooseSkin: { code: 'goose_default', assetUrl: null },
  frame: { code: 'frame_default', assetUrl: null },
};

describe('SellersPublicService', () => {
  const approvedAt = new Date('2026-09-01T12:00:00Z');
  const seller = (overrides: Partial<Seller> = {}) =>
    ({
      sellerId: 4,
      userId: 'user-4',
      displayName: 'Funko Corner CR',
      description: 'Funkos originales',
      location: 'San José',
      isVerified: true,
      completedSalesCount: 15,
      paymentId: 9,
      approvedAt,
      user: {
        id: 'user-4',
        email: 'karina@mynted.test',
        photoUrl: 'https://cdn/a.png',
        location: 'Heredia',
      },
      ...overrides,
    }) as unknown as Seller;

  let service: SellersPublicService;
  let sellerRepository: { findOne: jest.Mock };
  let responseTimeService: { getForUser: jest.Mock };
  let userBadgeRepository: { findOne: jest.Mock };
  let usersService: { getSellerRatings: jest.Mock };
  let cosmeticsService: {
    getEffectiveCosmeticsForUsers: jest.Mock;
    getEffectiveSummaryForUsers: jest.Mock;
  };
  let productsService: {
    countPublicBySeller: jest.Mock;
    findSellerTags: jest.Mock;
    findAll: jest.Mock;
  };

  beforeEach(() => {
    sellerRepository = { findOne: jest.fn().mockResolvedValue(seller()) };
    responseTimeService = {
      getForUser: jest
        .fn()
        .mockResolvedValue({ medianMinutes: 20, sampleSize: 3 }),
    };
    userBadgeRepository = { findOne: jest.fn().mockResolvedValue(null) };
    cosmeticsService = {
      getEffectiveCosmeticsForUsers: jest
        .fn()
        .mockResolvedValue(
          new Map([['user-4', { isPro: false, cosmetics: DEFAULT_COSMETICS }]]),
        ),
      getEffectiveSummaryForUsers: jest.fn().mockResolvedValue(
        new Map([
          [
            'user-4',
            {
              isPro: false,
              frame: { code: 'frame_default', assetUrl: null },
            },
          ],
        ]),
      ),
    };
    usersService = {
      getSellerRatings: jest
        .fn()
        .mockResolvedValue(
          new Map([[4, { ratingAverage: 4.7, reviewsCount: 12 }]]),
        ),
    };
    productsService = {
      countPublicBySeller: jest.fn().mockResolvedValue(new Map([[4, 8]])),
      findSellerTags: jest
        .fn()
        .mockResolvedValue([{ tagId: 3, name: 'Funko Pop', count: 5 }]),
      findAll: jest.fn().mockResolvedValue({ data: [], pagination: {} }),
    };
    service = new SellersPublicService(
      sellerRepository as unknown as Repository<Seller>,
      userBadgeRepository as unknown as Repository<UserBadge>,
      usersService as unknown as UsersService,
      productsService as unknown as ProductsService,
      responseTimeService as unknown as ResponseTimeService,
      cosmeticsService as unknown as CosmeticsService,
    );
  });

  describe('getStore', () => {
    it('arma la tienda sin payment_info ni correo, reutilizando ratings y conteos', async () => {
      await expect(service.getStore(4)).resolves.toEqual({
        sellerId: 4,
        userId: 'user-4',
        displayName: 'Funko Corner CR',
        description: 'Funkos originales',
        location: 'San José',
        photoUrl: 'https://cdn/a.png',
        bannerUrl: null,
        cosmetics: DEFAULT_COSMETICS,
        isVerified: true,
        isPro: false,
        frame: { code: 'frame_default', assetUrl: null },
        ratingAverage: 4.7,
        reviewsCount: 12,
        completedSalesCount: 15,
        activeProductsCount: 8,
        sellerSince: approvedAt,
        responseTime: { medianMinutes: 20, sampleSize: 3 },
      });
      expect(responseTimeService.getForUser).toHaveBeenCalledWith('user-4');
      expect(usersService.getSellerRatings).toHaveBeenCalledWith([4]);
      expect(productsService.countPublicBySeller).toHaveBeenCalledWith([4]);
      expect(userBadgeRepository.findOne).not.toHaveBeenCalled();
    });

    it('isPro es true si el dueño de la tienda tiene Pro vigente', async () => {
      cosmeticsService.getEffectiveCosmeticsForUsers.mockResolvedValue(
        new Map([['user-4', { isPro: true, cosmetics: DEFAULT_COSMETICS }]]),
      );

      await expect(service.getStore(4)).resolves.toMatchObject({ isPro: true });
      expect(
        cosmeticsService.getEffectiveCosmeticsForUsers,
      ).toHaveBeenCalledWith(['user-4']);
    });

    it('frame es el marco efectivo del dueño (igual a cosmetics.frame)', async () => {
      const gold = {
        ...DEFAULT_COSMETICS,
        frame: { code: 'frame_gold', assetUrl: 'https://cdn/gold.png' },
      };
      cosmeticsService.getEffectiveCosmeticsForUsers.mockResolvedValue(
        new Map([['user-4', { isPro: true, cosmetics: gold }]]),
      );

      await expect(service.getStore(4)).resolves.toMatchObject({
        frame: gold.frame,
        cosmetics: { frame: gold.frame },
      });
    });

    it('bannerUrl es el banner efectivo del dueño y cosmetics trae el resto', async () => {
      const custom = {
        banner: {
          source: 'custom',
          code: null,
          url: 'https://res.cloudinary.com/x/image/upload/v1/banner.gif',
          staticUrl: 'https://res.cloudinary.com/x/image/upload/v1/banner.jpg',
          isAnimated: true,
        },
        gooseSkin: { code: 'goose_ninja', assetUrl: null },
        frame: { code: 'frame_default', assetUrl: null },
      };
      cosmeticsService.getEffectiveCosmeticsForUsers.mockResolvedValue(
        new Map([['user-4', { isPro: true, cosmetics: custom }]]),
      );

      await expect(service.getStore(4)).resolves.toMatchObject({
        bannerUrl: custom.banner.url,
        cosmetics: custom,
      });
      expect(
        cosmeticsService.getEffectiveCosmeticsForUsers,
      ).toHaveBeenCalledTimes(1);
    });

    it('solo busca vendedores aprobados con cuenta activa', async () => {
      await service.getStore(4);

      expect(sellerRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sellerId: 4, isVerified: true, user: { isActive: true } },
        }),
      );
    });

    it('404 si no está aprobado, está desactivado o no existe', async () => {
      sellerRepository.findOne.mockResolvedValue(null);

      await expect(service.getStore(4)).rejects.toThrow(
        new NotFoundException('Tienda no encontrada'),
      );
    });

    it('404 sin consultar si el id no cabe en int4', async () => {
      await expect(service.getStore(99_999_999_999)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getStore(0)).rejects.toThrow(NotFoundException);
      expect(sellerRepository.findOne).not.toHaveBeenCalled();
    });

    it('sin location en la tienda usa la del usuario', async () => {
      sellerRepository.findOne.mockResolvedValue(seller({ location: '  ' }));

      await expect(service.getStore(4)).resolves.toMatchObject({
        location: 'Heredia',
      });
    });

    it('sin approved_at usa la fecha del badge verified_seller', async () => {
      const awardedAt = new Date('2026-05-10T08:00:00Z');
      sellerRepository.findOne.mockResolvedValue(seller({ approvedAt: null }));
      userBadgeRepository.findOne.mockResolvedValue({ awardedAt });

      await expect(service.getStore(4)).resolves.toMatchObject({
        sellerSince: awardedAt,
      });
      expect(userBadgeRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-4', badge: { code: 'verified_seller' } },
        }),
      );
    });

    it('sin approved_at ni badge, sellerSince es null', async () => {
      sellerRepository.findOne.mockResolvedValue(seller({ approvedAt: null }));

      await expect(service.getStore(4)).resolves.toMatchObject({
        sellerSince: null,
      });
    });

    it('sin reseñas ni productos: rating null y conteos en 0', async () => {
      usersService.getSellerRatings.mockResolvedValue(new Map());
      productsService.countPublicBySeller.mockResolvedValue(new Map());

      await expect(service.getStore(4)).resolves.toMatchObject({
        ratingAverage: null,
        reviewsCount: 0,
        activeProductsCount: 0,
      });
    });
  });

  describe('findProducts', () => {
    const query = Object.assign(new GetSellerProductsQueryDto(), {
      tag: 3,
      status: ProductStatus.SOLD,
      sort: ProductSort.PRICE_ASC,
      page: 2,
      limit: 5,
    });

    it('reutiliza findAll limitado al vendedor y sin comunidades privadas', async () => {
      await service.findProducts(4, query, 'viewer-id', 'USD');

      expect(productsService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          sellerId: 4,
          publicCommunitiesOnly: true,
          tag: 3,
          status: ProductStatus.SOLD,
          sort: ProductSort.PRICE_ASC,
          page: 2,
          limit: 5,
        }),
        'viewer-id',
        'USD',
      );
    });

    it('404 si la tienda no es pública, sin listar productos', async () => {
      sellerRepository.findOne.mockResolvedValue(null);

      await expect(
        service.findProducts(4, query, undefined, 'CRC'),
      ).rejects.toThrow(NotFoundException);
      expect(productsService.findAll).not.toHaveBeenCalled();
    });
  });

  describe('getTags', () => {
    it('valida la tienda y delega en la query de productos públicos', async () => {
      await expect(service.getTags(4)).resolves.toEqual([
        { tagId: 3, name: 'Funko Pop', count: 5 },
      ]);
      expect(productsService.findSellerTags).toHaveBeenCalledWith(4);
    });

    it('404 si la tienda no es pública', async () => {
      sellerRepository.findOne.mockResolvedValue(null);

      await expect(service.getTags(4)).rejects.toThrow(NotFoundException);
      expect(productsService.findSellerTags).not.toHaveBeenCalled();
    });
  });
});
