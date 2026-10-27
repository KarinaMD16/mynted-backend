import { Repository } from 'typeorm';
import { Community } from '../community/entities/community.entity';
import { Product } from '../products/entities/product.entity';
import { Seller } from '../sellers/entities/seller.entity';
import { ResponseTimeService } from '../response-time/response-time.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { Report } from '../reports/entities/report.entity';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

const queryBuilder = (count: number) => ({
  innerJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getCount: jest.fn().mockResolvedValue(count),
});

describe('UsersService administrative stats', () => {
  it('counts users, approved sellers, communities, products and pending reports', async () => {
    const sellerQuery = queryBuilder(2);
    const productQuery = queryBuilder(5);
    const usersRepository = { count: jest.fn().mockResolvedValue(9) };
    const sellersRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(sellerQuery),
    };
    const communityRepository = {
      count: jest.fn().mockResolvedValue(4),
    };
    const productRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(productQuery),
    };
    const reportRepository = {
      count: jest.fn().mockResolvedValue(3),
    };
    const service = new UsersService(
      usersRepository as unknown as Repository<User>,
      {} as Repository<never>,
      {} as CloudinaryService,
      sellersRepository as unknown as Repository<Seller>,
      {} as ResponseTimeService,
      undefined,
      undefined,
      undefined,
      productRepository as unknown as Repository<Product>,
      undefined,
      undefined,
      undefined,
      undefined,
      communityRepository as unknown as Repository<Community>,
      reportRepository as unknown as Repository<Report>,
    );

    await expect(service.getStats()).resolves.toEqual({
      totalUsers: 9,
      approvedSellers: 2,
      activeCommunities: 4,
      activeProducts: 5,
      pendingReports: 3,
    });

    expect(usersRepository.count).toHaveBeenCalledWith();
    expect(communityRepository.count).toHaveBeenCalledWith({
      where: { isActive: true },
    });
    expect(reportRepository.count).toHaveBeenCalledWith({
      where: { status: 'pending' },
    });
    expect(sellerQuery.where).toHaveBeenCalledWith('seller.is_verified = true');
    expect(productQuery.where).toHaveBeenCalledWith(
      'product.status = :activeProductStatus',
      { activeProductStatus: 'active' },
    );
  });
});
