import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CosmeticsService } from '../cosmetics/cosmetics.service';
import { ProStatusService } from '../pro-status/pro-status.service';
import { ResponseTimeService } from '../response-time/response-time.service';
import { Seller } from '../sellers/entities/seller.entity';
import { UserOAuthAccount } from './entities/user-oauth-account.entity';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

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

describe('UsersService', () => {
  let service: UsersService;
  let usersRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let cloudinaryService: { uploadImage: jest.Mock };
  let responseTimeService: { getForUsers: jest.Mock };
  let proStatusService: { proUserIds: jest.Mock; isPro: jest.Mock };
  let cosmeticsService: { getEffectiveForUsers: jest.Mock };

  beforeEach(() => {
    usersRepository = {
      findOne: jest.fn(),
      save: jest.fn((user: User) => Promise.resolve(user)),
    };
    cloudinaryService = { uploadImage: jest.fn() };
    cosmeticsService = {
      getEffectiveForUsers: jest.fn((ids: string[]) =>
        Promise.resolve(new Map(ids.map((id) => [id, DEFAULT_COSMETICS]))),
      ),
    };
    proStatusService = {
      proUserIds: jest.fn().mockResolvedValue(new Set<string>()),
      isPro: jest.fn().mockResolvedValue(false),
    };
    responseTimeService = {
      getForUsers: jest
        .fn()
        .mockResolvedValue(
          new Map([['seller-id', { medianMinutes: 20, sampleSize: 3 }]]),
        ),
    };

    service = new UsersService(
      usersRepository as unknown as Repository<User>,
      {} as Repository<UserOAuthAccount>,
      cloudinaryService as unknown as CloudinaryService,
      {} as Repository<Seller>,
      responseTimeService as unknown as ResponseTimeService,
      proStatusService as unknown as ProStatusService,
      cosmeticsService as unknown as CosmeticsService,
    );
  });

  describe('toPublicUsers', () => {
    const approvedSeller = {
      sellerId: 7,
      userId: 'seller-id',
      displayName: 'Funko Corner',
      isVerified: true,
    } as Seller;

    const build = (sellers: Seller[]) => {
      const sellersRepository = {
        find: jest.fn().mockResolvedValue(sellers),
        findOne: jest.fn().mockResolvedValue(sellers[0] ?? null),
      };
      const publicService = new UsersService(
        usersRepository as unknown as Repository<User>,
        {} as Repository<UserOAuthAccount>,
        cloudinaryService as unknown as CloudinaryService,
        sellersRepository as unknown as Repository<Seller>,
        responseTimeService as unknown as ResponseTimeService,
        proStatusService as unknown as ProStatusService,
        cosmeticsService as unknown as CosmeticsService,
      );
      jest
        .spyOn(publicService, 'getSellerRatings')
        .mockResolvedValue(
          new Map([[7, { ratingAverage: 4.5, reviewsCount: 2 }]]),
        );
      return { publicService, sellersRepository };
    };

    it('solo consulta vendedores aprobados', async () => {
      const { publicService, sellersRepository } = build([approvedSeller]);

      const [seller] = await publicService.toPublicUsers([
        { id: 'seller-id', username: 'karina' } as User,
      ]);

      expect(sellersRepository.find).toHaveBeenCalledWith({
        where: { userId: expect.anything() as unknown, isVerified: true },
      });
      expect(seller.seller).toEqual({
        sellerId: 7,
        displayName: 'Funko Corner',
        isVerified: true,
        ratingAverage: 4.5,
        reviewsCount: 2,
        responseTime: { medianMinutes: 20, sampleSize: 3 },
      });
    });

    it('consulta ratings y tiempos de respuesta una sola vez para todos', async () => {
      const { publicService } = build([approvedSeller]);

      await publicService.toPublicUsers([
        { id: 'seller-id', username: 'karina' } as User,
        { id: 'otro-id', username: 'otro' } as User,
      ]);

      expect(responseTimeService.getForUsers).toHaveBeenCalledTimes(1);
      expect(responseTimeService.getForUsers).toHaveBeenCalledWith([
        'seller-id',
      ]);
    });

    it('marca isPro por usuario con una sola consulta para toda la lista', async () => {
      const { publicService } = build([approvedSeller]);
      proStatusService.proUserIds.mockResolvedValue(new Set(['otro-id']));

      const result = await publicService.toPublicUsers([
        { id: 'seller-id', username: 'karina' } as User,
        { id: 'otro-id', username: 'otro' } as User,
        { id: 'tercero-id', username: 'tercero' } as User,
      ]);

      expect(result.map((user) => [user.username, user.isPro])).toEqual([
        ['karina', false],
        ['otro', true],
        ['tercero', false],
      ]);
      expect(proStatusService.proUserIds).toHaveBeenCalledTimes(1);
      expect(proStatusService.proUserIds).toHaveBeenCalledWith([
        'seller-id',
        'otro-id',
        'tercero-id',
      ]);
    });

    it('agrega los cosméticos efectivos con una consulta para toda la lista, reutilizando el lote Pro', async () => {
      const { publicService } = build([approvedSeller]);
      const pro = new Set(['otro-id']);
      proStatusService.proUserIds.mockResolvedValue(pro);
      const custom = {
        ...DEFAULT_COSMETICS,
        banner: { ...DEFAULT_COSMETICS.banner, source: 'custom' },
      };
      cosmeticsService.getEffectiveForUsers.mockResolvedValue(
        new Map([
          ['seller-id', DEFAULT_COSMETICS],
          ['otro-id', custom],
        ]),
      );

      const result = await publicService.toPublicUsers([
        { id: 'seller-id', username: 'karina' } as User,
        { id: 'otro-id', username: 'otro' } as User,
      ]);

      expect(result.map((user) => user.cosmetics)).toEqual([
        DEFAULT_COSMETICS,
        custom,
      ]);
      expect(cosmeticsService.getEffectiveForUsers).toHaveBeenCalledTimes(1);
      expect(cosmeticsService.getEffectiveForUsers).toHaveBeenCalledWith(
        ['seller-id', 'otro-id'],
        pro,
      );
      expect(proStatusService.proUserIds).toHaveBeenCalledTimes(1);
    });

    it('un solicitante pendiente o rechazado sale sin objeto seller', async () => {
      // La consulta filtrada por isVerified no lo devuelve.
      const { publicService } = build([]);

      const [pending] = await publicService.toPublicUsers([
        { id: 'pending-id', username: 'pendiente' } as User,
      ]);

      expect(pending).not.toHaveProperty('seller');
    });
  });

  it('actualiza únicamente el perfil del usuario autenticado', async () => {
    const user = { id: 'user-id', username: 'anterior' } as User;
    const photo = { mimetype: 'image/png' } as Express.Multer.File;
    usersRepository.findOne
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce(null);
    cloudinaryService.uploadImage.mockResolvedValue({
      url: 'https://example.com/photo.png',
    });

    const result = await service.updateProfile(
      user.id,
      { username: 'nuevo_username' },
      photo,
    );

    expect(result.username).toBe('nuevo_username');
    expect(result.photoUrl).toBe('https://example.com/photo.png');
    expect(usersRepository.save).toHaveBeenCalledWith(user);
  });

  it('impide que un superadministrador se desactive a sí mismo', async () => {
    await expect(service.deactivate('admin-id', 'admin-id')).rejects.toThrow(
      ForbiddenException,
    );
    expect(usersRepository.findOne).not.toHaveBeenCalled();
    expect(usersRepository.save).not.toHaveBeenCalled();
  });

  it('desactiva al usuario indicado', async () => {
    const user = { id: 'user-id', isActive: true } as User;
    usersRepository.findOne.mockResolvedValue(user);

    const result = await service.deactivate(user.id, 'admin-id');

    expect(result.isActive).toBe(false);
    expect(usersRepository.save).toHaveBeenCalledWith(user);
  });

  it('activa al usuario indicado', async () => {
    const user = { id: 'user-id', isActive: false } as User;
    usersRepository.findOne.mockResolvedValue(user);

    const result = await service.activate(user.id);

    expect(result.isActive).toBe(true);
    expect(usersRepository.save).toHaveBeenCalledWith(user);
  });

  describe('findMe', () => {
    it('agrega el objeto seller a la entidad si es vendedor aprobado', async () => {
      const user = Object.assign(new User(), {
        id: 'seller-id',
        email: 'karina@mynted.test',
        username: 'karina',
      });
      usersRepository.findOne.mockResolvedValue(user);
      const sellersRepository = {
        findOne: jest.fn().mockResolvedValue({
          sellerId: 7,
          userId: 'seller-id',
          displayName: 'Funko Corner',
          isVerified: true,
        }),
      };
      const meService = new UsersService(
        usersRepository as unknown as Repository<User>,
        {} as Repository<UserOAuthAccount>,
        cloudinaryService as unknown as CloudinaryService,
        sellersRepository as unknown as Repository<Seller>,
        responseTimeService as unknown as ResponseTimeService,
        proStatusService as unknown as ProStatusService,
        cosmeticsService as unknown as CosmeticsService,
      );
      jest.spyOn(meService, 'getSellerRatings').mockResolvedValue(new Map());

      const me = await meService.findMe('seller-id');

      // Sigue siendo la entidad (el serializador aplica @Exclude) y conserva
      // sus campos.
      expect(me).toBeInstanceOf(User);
      expect(me).toMatchObject({
        email: 'karina@mynted.test',
        seller: {
          sellerId: 7,
          ratingAverage: null,
          reviewsCount: 0,
          responseTime: { medianMinutes: 20, sampleSize: 3 },
        },
      });
      expect(sellersRepository.findOne).toHaveBeenCalledWith({
        where: { userId: 'seller-id', isVerified: true },
      });
    });

    it('agrega isPro a la entidad, también sin tienda', async () => {
      const user = Object.assign(new User(), { id: 'pro-id' });
      usersRepository.findOne.mockResolvedValue(user);
      proStatusService.isPro.mockResolvedValue(true);
      const meService = new UsersService(
        usersRepository as unknown as Repository<User>,
        {} as Repository<UserOAuthAccount>,
        cloudinaryService as unknown as CloudinaryService,
        {
          findOne: jest.fn().mockResolvedValue(null),
        } as unknown as Repository<Seller>,
        responseTimeService as unknown as ResponseTimeService,
        proStatusService as unknown as ProStatusService,
        cosmeticsService as unknown as CosmeticsService,
      );

      const me = await meService.findMe('pro-id');

      expect(me).toBeInstanceOf(User);
      expect(me.isPro).toBe(true);
      expect(proStatusService.isPro).toHaveBeenCalledWith('pro-id');
    });

    it('agrega los cosméticos efectivos a la entidad', async () => {
      const user = Object.assign(new User(), { id: 'pro-id' });
      usersRepository.findOne.mockResolvedValue(user);
      proStatusService.isPro.mockResolvedValue(true);
      const meService = new UsersService(
        usersRepository as unknown as Repository<User>,
        {} as Repository<UserOAuthAccount>,
        cloudinaryService as unknown as CloudinaryService,
        {
          findOne: jest.fn().mockResolvedValue(null),
        } as unknown as Repository<Seller>,
        responseTimeService as unknown as ResponseTimeService,
        proStatusService as unknown as ProStatusService,
        cosmeticsService as unknown as CosmeticsService,
      );

      const me = await meService.findMe('pro-id');

      expect(me.cosmetics).toEqual(DEFAULT_COSMETICS);
      // El usuario Pro se pasa ya resuelto: no se vuelve a consultar.
      expect(cosmeticsService.getEffectiveForUsers).toHaveBeenCalledWith(
        ['pro-id'],
        new Set(['pro-id']),
      );
    });

    it('sin tienda aprobada devuelve la entidad sin objeto seller', async () => {
      const user = Object.assign(new User(), { id: 'buyer-id' });
      usersRepository.findOne.mockResolvedValue(user);
      const meService = new UsersService(
        usersRepository as unknown as Repository<User>,
        {} as Repository<UserOAuthAccount>,
        cloudinaryService as unknown as CloudinaryService,
        {
          findOne: jest.fn().mockResolvedValue(null),
        } as unknown as Repository<Seller>,
        responseTimeService as unknown as ResponseTimeService,
        proStatusService as unknown as ProStatusService,
        cosmeticsService as unknown as CosmeticsService,
      );

      const me = await meService.findMe('buyer-id');

      expect(me).toBe(user);
      expect(me.isPro).toBe(false);
      expect(me).not.toHaveProperty('seller');
      expect(responseTimeService.getForUsers).not.toHaveBeenCalled();
    });
  });
  // El alcance de las reseñas del vendedor (productos borrados incluidos,
  // solo vendedores aprobados) se prueba con datos reales en
  // test/seller-rating.e2e-spec.ts; aquí se fija cómo se arma la consulta.
  describe('reseñas del vendedor (rating y distribución)', () => {
    const build = (rows: unknown[]) => {
      const qb: Record<string, jest.Mock> = {};
      for (const method of [
        'select',
        'addSelect',
        'from',
        'withDeleted',
        'innerJoin',
        'where',
        'groupBy',
      ]) {
        qb[method] = jest.fn().mockReturnValue(qb);
      }
      qb.getRawMany = jest.fn().mockResolvedValue(rows);
      const sellersRepository = {
        manager: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
      };
      const ratingsService = new UsersService(
        usersRepository as unknown as Repository<User>,
        {} as Repository<UserOAuthAccount>,
        cloudinaryService as unknown as CloudinaryService,
        sellersRepository as unknown as Repository<Seller>,
        responseTimeService as unknown as ResponseTimeService,
        proStatusService as unknown as ProStatusService,
        cosmeticsService as unknown as CosmeticsService,
      );
      return { ratingsService, qb };
    };

    it('getSellerRatings incluye productos borrados y mantiene el filtro de vendedor aprobado', async () => {
      const { ratingsService, qb } = build([
        { sellerId: 7, average: '4.3', count: '3' },
      ]);

      await expect(ratingsService.getSellerRatings([7, 8])).resolves.toEqual(
        new Map([[7, { ratingAverage: 4.3, reviewsCount: 3 }]]),
      );

      expect(qb.withDeleted).toHaveBeenCalledTimes(1);
      expect(qb.innerJoin).toHaveBeenCalledWith(
        Seller,
        'seller',
        'seller.seller_id = product.seller_id AND seller.is_verified = true',
      );
      expect(qb.where).toHaveBeenCalledWith(
        'product.seller_id IN (:...sellerIds)',
        { sellerIds: [7, 8] },
      );
    });

    it('getSellerRatings no consulta si no hay vendedores', async () => {
      const { ratingsService, qb } = build([]);

      await expect(ratingsService.getSellerRatings([])).resolves.toEqual(
        new Map(),
      );
      expect(qb.getRawMany).not.toHaveBeenCalled();
    });

    it('la distribución usa la misma consulta (borrados incluidos, solo aprobados)', async () => {
      const { ratingsService, qb } = build([
        { rating: 4, count: '2' },
        { rating: 5, count: '1' },
      ]);

      await expect(
        ratingsService.getSellerRatingDistribution(7),
      ).resolves.toEqual(
        new Map([
          [4, 2],
          [5, 1],
        ]),
      );

      expect(qb.withDeleted).toHaveBeenCalledTimes(1);
      expect(qb.innerJoin).toHaveBeenCalledWith(
        Seller,
        'seller',
        'seller.seller_id = product.seller_id AND seller.is_verified = true',
      );
      expect(qb.where).toHaveBeenCalledWith('product.seller_id = :sellerId', {
        sellerId: 7,
      });
    });
  });
});
