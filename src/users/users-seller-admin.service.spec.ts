import { Repository } from 'typeorm';
import { Product, ProductStatus } from '../products/entities/product.entity';
import { PaymentTransaction } from '../payments/entities/payment-transaction.entity';
import { Seller } from '../sellers/entities/seller.entity';
import { User, SellerRequestStatus, UserRole } from './entities/user.entity';
import { UsersService } from './users.service';

const queryBuilder = (rows: Array<{ sellerId: number; count: string }>) => ({
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  withDeleted: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  getRawMany: jest.fn().mockResolvedValue(rows),
});

describe('UsersService seller administration', () => {
  const userRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
  };
  const sellersRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
  };
  const productRepository = {
    find: jest.fn(),
  };

  const buildService = (users: User[], sellers: Seller[]) => {
    userRepository.find.mockResolvedValue(users);
    sellersRepository.find.mockResolvedValue(sellers);
    sellersRepository.findOne.mockResolvedValue(sellers[0] ?? null);
    productRepository.find.mockResolvedValue([]);

    const productCountQb = queryBuilder([{ sellerId: 10, count: '2' }]);
    const reportCountQb = queryBuilder([{ sellerId: 10, count: '4' }]);
    const salesCountQb = queryBuilder([{ sellerId: 10, count: '3' }]);
    const productDataRepository = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce(productCountQb)
        .mockReturnValueOnce(reportCountQb),
    };
    const salesDataRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(salesCountQb),
    };
    const dataSource = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === PaymentTransaction) {
          return salesDataRepository;
        }
        return productDataRepository;
      }),
    };

    return new UsersService(
      userRepository as unknown as Repository<User>,
      {} as Repository<never>,
      {} as never,
      sellersRepository as unknown as Repository<Seller>,
      {} as never,
      undefined,
      undefined,
      undefined,
      productRepository as unknown as Repository<Product>,
      dataSource as never,
    );
  };

  const seller = Object.assign(new Seller(), {
    sellerId: 10,
    userId: 'seller-id',
    isVerified: true,
  });

  it('filters by sellerStatus and maps independent seller metrics', async () => {
    const user = Object.assign(new User(), {
      id: 'seller-id',
      username: 'seller',
      role: UserRole.SELLER,
      sellerRequestStatus: SellerRequestStatus.APPROVED,
      isActive: true,
    });
    const service = buildService([user], [seller]);

    const result = await service.findAll({
      sellerStatus: SellerRequestStatus.APPROVED,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'seller-id',
      seller: {
        sellerId: 10,
        status: SellerRequestStatus.APPROVED,
        isVerified: true,
        productCount: 2,
        salesCount: 3,
        reportsReceivedCount: 4,
      },
    });
  });

  it('returns seller null for a normal user and includes hidden products in admin detail', async () => {
    const user = Object.assign(new User(), {
      id: 'seller-id',
      username: 'seller',
      role: UserRole.SELLER,
      sellerRequestStatus: SellerRequestStatus.APPROVED,
      isActive: true,
    });
    const service = buildService([user], [seller]);
    productRepository.find.mockResolvedValue([
      {
        id: 1,
        sellerId: 10,
        title: 'Oculto',
        status: ProductStatus.INACTIVE,
        isHidden: true,
        isVisible: false,
        publishedAt: null,
      },
    ]);
    userRepository.findOne.mockResolvedValue(user);

    const result = await service.findAdminById('seller-id');

    expect(
      (result as User & { seller: Record<string, unknown> }).seller,
    ).toMatchObject({
      productCount: 2,
      salesCount: 3,
      reportsReceivedCount: 4,
      products: [
        expect.objectContaining({ id: 1, isHidden: true, status: 'inactive' }),
      ],
    });
  });
});
