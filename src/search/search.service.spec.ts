import { Repository } from 'typeorm';
import { Community } from '../community/entities/community.entity';
import { ForumService } from '../community/forum.service';
import { ProductsService } from '../products/products.service';
import { SellersPublicService } from '../sellers-public/sellers-public.service';
import { UsersService } from '../users/users.service';
import { SearchType } from './dto/search-query.dto';
import { SearchService } from './search.service';

describe('SearchService', () => {
  const page = (data: unknown[]) => ({
    data,
    pagination: { page: 1, limit: 5, total: data.length, totalPages: 1 },
  });

  let service: SearchService;
  let searchStores: jest.Mock;

  beforeEach(() => {
    searchStores = jest.fn().mockResolvedValue(page([{ sellerId: 4 }]));
    const communityQuery = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    service = new SearchService(
      {
        createQueryBuilder: () => communityQuery,
      } as unknown as Repository<Community>,
      {
        searchPublic: jest.fn().mockResolvedValue(page([])),
      } as unknown as UsersService,
      {
        searchPublic: jest.fn().mockResolvedValue(page([])),
      } as unknown as ProductsService,
      {
        searchPosts: jest.fn().mockResolvedValue(page([])),
      } as unknown as ForumService,
      { searchStores } as unknown as SellersPublicService,
    );
  });

  it('type=stores delega en la búsqueda de tiendas con la paginación pedida', async () => {
    const result = await service.search(
      { q: 'funko', type: SearchType.STORES, page: 2, limit: 10 },
      undefined,
      'CRC',
    );

    expect(searchStores).toHaveBeenCalledWith('funko', 2, 10);
    expect(result).toMatchObject({
      type: SearchType.STORES,
      data: [{ sellerId: 4 }],
    });
  });

  it('el resumen sin type incluye stores (primeros 5 y total)', async () => {
    const result = await service.search(
      { q: 'funko', page: 1, limit: 10 },
      undefined,
      'CRC',
    );

    expect(searchStores).toHaveBeenCalledWith('funko', 1, 5);
    expect(result).toMatchObject({
      q: 'funko',
      stores: { data: [{ sellerId: 4 }], total: 1 },
    });
  });
});
