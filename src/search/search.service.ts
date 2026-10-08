import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { escapeLike } from '../common/escape-like';
import { Community } from '../community/entities/community.entity';
import { ForumService } from '../community/forum.service';
import { ProductsService } from '../products/products.service';
import { UsersService } from '../users/users.service';
import { SearchQueryDto, SearchType } from './dto/search-query.dto';

// Cantidad de resultados por tipo en el resumen (búsqueda sin type).
const SUMMARY_LIMIT = 5;

interface SearchPage<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(Community)
    private readonly communityRepository: Repository<Community>,
    private readonly usersService: UsersService,
    private readonly productsService: ProductsService,
    private readonly forumService: ForumService,
  ) {}

  async search(query: SearchQueryDto, viewerId: string | undefined) {
    if (query.type) {
      return {
        type: query.type,
        ...(await this.searchType(
          query.type,
          query.q,
          query.page,
          query.limit,
          viewerId,
        )),
      };
    }

    // Resumen: los primeros resultados de cada tipo con su total.
    const [users, posts, products, communities] = await Promise.all([
      this.searchType(SearchType.USERS, query.q, 1, SUMMARY_LIMIT, viewerId),
      this.searchType(SearchType.POSTS, query.q, 1, SUMMARY_LIMIT, viewerId),
      this.searchType(SearchType.PRODUCTS, query.q, 1, SUMMARY_LIMIT, viewerId),
      this.searchType(
        SearchType.COMMUNITIES,
        query.q,
        1,
        SUMMARY_LIMIT,
        viewerId,
      ),
    ]);

    const summarize = <T>(result: SearchPage<T>) => ({
      data: result.data,
      total: result.pagination.total,
    });

    return {
      q: query.q,
      users: summarize(users),
      posts: summarize(posts),
      products: summarize(products),
      communities: summarize(communities),
    };
  }

  private searchType(
    type: SearchType,
    q: string,
    page: number,
    limit: number,
    viewerId: string | undefined,
  ): Promise<SearchPage<unknown>> {
    switch (type) {
      case SearchType.USERS:
        return this.usersService.searchPublic({ q, page, limit });
      case SearchType.PRODUCTS:
        return this.productsService.searchPublic(q, page, limit, viewerId);
      case SearchType.COMMUNITIES:
        return this.searchCommunities(q, page, limit);
      case SearchType.POSTS:
      case SearchType.FORUMS:
        return this.forumService.searchPosts(q, page, limit, viewerId);
    }
  }

  // Solo comunidades públicas y activas; coincidencia parcial en nombre o
  // descripción.
  private async searchCommunities(
    q: string,
    page: number,
    limit: number,
  ): Promise<SearchPage<unknown>> {
    const [communities, total] = await this.communityRepository
      .createQueryBuilder('community')
      .where('community.is_active = :isActive', { isActive: true })
      .andWhere('community.is_private = :isPrivate', { isPrivate: false })
      .andWhere(
        '(community.name ILIKE :text OR community.description ILIKE :text)',
        { text: `%${escapeLike(q)}%` },
      )
      .orderBy('community.name', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data: communities.map((community) => ({
        id: community.id,
        name: community.name,
        slug: community.slug,
        description: community.description,
        imageUrl: community.imageUrl,
        bannerUrl: community.bannerUrl,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
