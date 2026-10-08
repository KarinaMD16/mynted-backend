import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadgeEvents } from '../badges/badge-events';
import {
  ArrayContains,
  DataSource,
  FindOptionsRelations,
  FindOptionsWhere,
  ILike,
  In,
  Repository,
} from 'typeorm';
import { escapeLike } from '../common/escape-like';
import { CommunityProfile } from '../community/entities/community-profile.entity';
import { Community } from '../community/entities/community.entity';
import {
  Favorite,
  FavoriteItemType,
} from '../community/entities/favorite.entity';
import { Tag } from '../community/entities/tag.entity';
import { Seller } from '../sellers/entities/seller.entity';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UsersService } from '../users/users.service';
import { UserTag } from '../user-tags/entities/user-tag.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductStatusDto } from './dto/update-product-status.dto';
import { GetProductsQueryDto } from './dto/get-products-query.dto';
import { GetRecommendedProductsQueryDto } from './dto/get-recommended-products-query.dto';
import { GetShopQueryDto } from './dto/get-shop-query.dto';
import { GetMyProductsQueryDto } from './dto/get-my-products-query.dto';
import {
  Product,
  ProductCondition,
  ProductStatus,
  ProductType,
} from './entities/product.entity';
import { ProductTag } from './entities/product-tag.entity';
import { ProductImage } from './entities/product-image.entity';
import { ProductRelated } from './entities/product-related.entity';
import { ProductView } from './entities/product-view.entity';
import {
  PUBLIC_COMMUNITY_ALTERNATIVES,
  PUBLIC_PRODUCT_WHERE,
  computeFinalPrice,
  finalPriceWhere,
} from './product-pricing';
import { ReviewsService } from './reviews.service';

// Máximo de productos que devuelve /products/:id/related (los elegidos por el
// vendedor son hasta 6, así que caben todos).
const RELATED_PRODUCTS_LIMIT = 6;

const DETAIL_RELATIONS = {
  seller: true,
  productTags: { tag: true },
  images: true,
};

export interface TagProductCard {
  id: number;
  title: string;
  price: number;
  discountPercent: number | null;
  finalPrice: number;
  currency: string;
  imageUrl: string;
  type: ProductType;
  condition: ProductCondition;
  isSaved: boolean;
  tags: { tagId: number; name: string }[];
  seller: {
    sellerId: number;
    displayName: string;
    photoUrl: string | null;
    isVerified: boolean;
  };
}

export type ShopSectionSource = 'interest' | 'popular';

export interface ShopSection {
  tag: { tagId: number; name: string };
  source: ShopSectionSource;
  totalProducts: number;
  products: TagProductCard[];
  pagination: {
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface SectionsPagination {
  page: number;
  limit: number;
  totalSections: number;
  totalPages: number;
}

export interface ShopResult {
  sections: ShopSection[];
  pagination: SectionsPagination;
}

interface TagGroup {
  tagId: number;
  ids: number[];
}

interface SectionPaginationQuery {
  page: number;
  limit: number;
  productsPage: number;
  productsLimit: number;
}

interface TagSection<T> {
  tag: { tagId: number; name: string };
  totalProducts: number;
  products: T[];
  pagination: { page: number; limit: number; totalPages: number };
}

export interface MyProductCard {
  id: number;
  title: string;
  price: number | null;
  discountPercent: number | null;
  finalPrice: number | null;
  currency: string | null;
  imageUrl: string | null;
  status: ProductStatus;
  isVisible: boolean;
  publishedAt: Date | null;
  type: ProductType | null;
  condition: ProductCondition | null;
  tags: { tagId: number; name: string }[];
  community: { id: number; name: string } | null;
}

export interface MyProductsSection {
  tag: { tagId: number; name: string };
  totalProducts: number;
  products: MyProductCard[];
  pagination: {
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface MyProductsStats {
  total: number;
  draft: number;
  active: number;
  sold: number;
  inactive: number;
}

export interface MyProductsResult {
  totalProducts: number;
  sections: MyProductsSection[];
  pagination: SectionsPagination;
}

export interface Paginated<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Producto tal como lo devuelven los listados públicos: la entidad más el
// precio final (con descuento) y si el usuario autenticado lo guardó.
export type ProductListItem = Product & {
  finalPrice: number;
  isSaved: boolean;
};

interface PublishableFields {
  description: string | null | undefined;
  price: number | null | undefined;
  type: ProductType | null | undefined;
  condition: ProductCondition | null | undefined;
  tagCount: number;
  hasImage: boolean;
  currency: string | null | undefined;
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Seller)
    private readonly sellerRepository: Repository<Seller>,
    @InjectRepository(Community)
    private readonly communityRepository: Repository<Community>,
    @InjectRepository(CommunityProfile)
    private readonly communityProfileRepository: Repository<CommunityProfile>,
    @InjectRepository(Tag)
    private readonly tagRepository: Repository<Tag>,
    @InjectRepository(UserTag)
    private readonly userTagRepository: Repository<UserTag>,
    @InjectRepository(Favorite)
    private readonly favoriteRepository: Repository<Favorite>,
    @InjectRepository(ProductView)
    private readonly productViewRepository: Repository<ProductView>,
    private readonly usersService: UsersService,
    private readonly reviewsService: ReviewsService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly dataSource: DataSource,
    @Optional()
    private readonly eventEmitter?: EventEmitter2,
  ) {}

  // Publica (o guarda como borrador con saveAsDraft) un producto. La
  // comunidad es opcional (null = sin comunidad); si se indica, el usuario
  // debe tener un communityProfile en ella. El rol de vendedor es global
  // (SellerGuard).
  async create(
    communityId: number | null,
    userId: string,
    dto: CreateProductDto,
    image: Express.Multer.File | undefined,
    images: Express.Multer.File[] | undefined,
  ) {
    const saveAsDraft = dto.saveAsDraft === true;

    if (communityId !== null) await this.ensureCommunityExists(communityId);

    const seller = await this.sellerRepository.findOne({ where: { userId } });
    if (!seller) {
      throw new ForbiddenException(
        'Debes completar tu activación de vendedor antes de publicar productos',
      );
    }

    const profile =
      communityId === null
        ? null
        : await this.communityProfileRepository.findOne({
            where: { userId, communityId },
            select: { communityProfileId: true },
          });
    if (communityId !== null && !profile) {
      throw new ForbiddenException(
        'Debes ser miembro de la comunidad para publicar productos en ella',
      );
    }

    await this.ensureTagsExist(dto.tagIds);
    const relatedIds = await this.validateRelatedProducts(
      seller.sellerId,
      dto.relatedProductIds,
    );

    const user = await this.usersService.findById(userId);
    const currency = user.currency ?? null;

    if (!saveAsDraft) {
      this.assertPublishable({
        description: dto.description,
        price: dto.price,
        type: dto.type,
        condition: dto.condition,
        tagCount: dto.tagIds?.length ?? 0,
        hasImage: image !== undefined,
        currency,
      });
    }

    const [coverUpload, galleryUploads] = await Promise.all([
      image ? this.cloudinaryService.uploadImage(image) : Promise.resolve(null),
      images && images.length > 0
        ? this.cloudinaryService.uploadImages(images)
        : Promise.resolve([]),
    ]);

    const productId = await this.dataSource.transaction(async (manager) => {
      const product = manager.create(Product, {
        title: dto.title,
        description: dto.description,
        price: dto.price,
        discountPercent: dto.discountPercent ?? null,
        currency: currency ?? undefined,
        imageUrl: coverUpload?.url,
        status: saveAsDraft ? ProductStatus.DRAFT : ProductStatus.ACTIVE,
        publishedAt: saveAsDraft ? null : new Date(),
        isVisible: dto.isVisible ?? true,
        type: dto.type,
        condition: dto.condition,
        shipsTo: dto.shipsTo ?? [],
        sellerId: seller.sellerId,
        communityId,
      });
      const savedProduct = await manager.save(Product, product);

      if (dto.tagIds && dto.tagIds.length > 0) {
        await manager.save(
          ProductTag,
          dto.tagIds.map((tagId) =>
            manager.create(ProductTag, { productId: savedProduct.id, tagId }),
          ),
        );
      }

      if (galleryUploads.length > 0) {
        await manager.save(
          ProductImage,
          galleryUploads.map((upload, index) =>
            manager.create(ProductImage, {
              productId: savedProduct.id,
              url: upload.url,
              order: index,
            }),
          ),
        );
      }

      if (relatedIds.length > 0) {
        await manager.save(
          ProductRelated,
          relatedIds.map((relatedProductId) =>
            manager.create(ProductRelated, {
              productId: savedProduct.id,
              relatedProductId,
            }),
          ),
        );
      }

      return savedProduct.id;
    });

    if (!saveAsDraft) {
      this.eventEmitter?.emit(BadgeEvents.PRODUCT_PUBLISHED, { userId });
    }

    return this.findDetail(productId, userId);
  }

  // Búsqueda global de productos: solo activos, visibles, de comunidades
  // públicas y no borrados; coincide en título o descripción.
  async searchPublic(
    q: string,
    page: number,
    limit: number,
    viewerId: string | undefined,
  ): Promise<Paginated<ProductListItem>> {
    const text = `%${escapeLike(q)}%`;
    const where = PUBLIC_COMMUNITY_ALTERNATIVES.flatMap((alternative) => [
      { ...PUBLIC_PRODUCT_WHERE, ...alternative, title: ILike(text) },
      { ...PUBLIC_PRODUCT_WHERE, ...alternative, description: ILike(text) },
    ]);

    const [data, total] = await this.productRepository.findAndCount({
      where,
      relations: { productTags: { tag: true } },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: await this.withSaved(data, viewerId),
      pagination: this.buildPagination(page, limit, total),
    };
  }

  async findAll(
    query: GetProductsQueryDto,
    viewerId: string | undefined,
  ): Promise<Paginated<ProductListItem>> {
    // Usa la API de repository (no QueryBuilder) a propósito: con relaciones
    // "to-many" (productTags), TypeORM pagina correctamente los productos
    // raíz primero y luego hidrata las relaciones, evitando que un producto
    // con varios tags rompa el skip/take.
    const where: FindOptionsWhere<Product> = { ...PUBLIC_PRODUCT_WHERE };

    if (query.communityId !== undefined) where.communityId = query.communityId;
    if (query.type !== undefined) where.type = query.type;
    if (query.condition !== undefined) where.condition = query.condition;
    if (query.currency !== undefined) where.currency = query.currency;
    if (query.shipTo !== undefined) {
      where.shipsTo = ArrayContains([query.shipTo]);
    }
    if (query.category !== undefined) {
      where.community = { categoryId: query.category };
    }
    if (query.tag !== undefined) {
      where.productTags = { tagId: query.tag };
    }
    const price = finalPriceWhere(query.priceMin, query.priceMax);
    if (price) where.price = price;

    const [data, total] = await this.productRepository.findAndCount({
      where,
      relations: { productTags: { tag: true } },
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      data: await this.withSaved(data, viewerId),
      pagination: this.buildPagination(query.page, query.limit, total),
    };
  }

  /**
   * Pantalla Shop con scroll infinito: una sección por cada tag que tenga
   * productos activos, paginadas con page/limit (secciones por página).
   * Con usuario autenticado primero van los tags de sus intereses y luego el
   * resto; sin usuario o sin intereses, todos van por popularidad
   * (tag con más productos activos). Cada producto aparece en una sola
   * sección: la primera (en orden) cuyo tag tenga, así no se repite.
   * Nunca se devuelven secciones vacías y totalProducts cuenta solo los
   * productos propios de esa sección. productsPage/productsLimit paginan los
   * productos dentro de cada sección.
   */
  async findShop(
    userId: string | undefined,
    query: GetShopQueryDto,
  ): Promise<ShopResult> {
    const active = await this.productRepository.find({
      where: {
        ...PUBLIC_PRODUCT_WHERE,
        ...(query.shipTo ? { shipsTo: ArrayContains([query.shipTo]) } : {}),
      },
      select: { id: true, createdAt: true, productTags: { tagId: true } },
      relations: { productTags: true },
      order: { createdAt: 'DESC', id: 'DESC' },
    });

    const interestTagIds = new Set<number>();
    if (userId) {
      const userTags = await this.userTagRepository.find({
        where: { userId },
        select: { tagId: true },
      });
      userTags.forEach((userTag) => interestTagIds.add(userTag.tagId));
    }

    const ranked = this.rankTagIds(active);
    const orderedTagIds = [
      ...ranked.filter((tagId) => interestTagIds.has(tagId)),
      ...ranked.filter((tagId) => !interestTagIds.has(tagId)),
    ];

    const { sections, pagination } = await this.buildTagSections(
      this.groupIdsByTag(active, orderedTagIds),
      query,
      { productTags: { tag: true }, seller: { user: true } },
      (product) => this.toTagProductCard(product),
    );

    // isSaved: una sola consulta de favoritos para toda la página.
    const saved = await this.getSavedProductIds(
      userId,
      sections.flatMap((section) => section.products.map((p) => p.id)),
    );
    sections.forEach((section) =>
      section.products.forEach((card) => {
        card.isSaved = saved.has(card.id);
      }),
    );

    return {
      sections: sections.map((section) => ({
        ...section,
        source: interestTagIds.has(section.tag.tagId)
          ? ('interest' as const)
          : ('popular' as const),
      })),
      pagination,
    };
  }

  // Tags ordenados por cantidad de productos (desc) y luego por id.
  private rankTagIds(products: Product[]): number[] {
    const counts = new Map<number, number>();
    for (const product of products) {
      for (const { tagId } of product.productTags) {
        counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map(([tagId]) => tagId);
  }

  // Asigna cada producto al primer tag (según orderedTagIds) que tenga, de
  // modo que no se repita entre secciones. Omite tags sin productos propios.
  private groupIdsByTag(
    products: Product[],
    orderedTagIds: number[],
  ): TagGroup[] {
    const rankOf = new Map(orderedTagIds.map((tagId, index) => [tagId, index]));
    const idsByTag = new Map<number, number[]>();
    for (const product of products) {
      if (product.productTags.length === 0) continue;
      const sectionTagId = product.productTags
        .map((productTag) => productTag.tagId)
        .sort((a, b) => rankOf.get(a)! - rankOf.get(b)!)[0];
      const ids = idsByTag.get(sectionTagId) ?? [];
      ids.push(product.id);
      idsByTag.set(sectionTagId, ids);
    }
    return orderedTagIds
      .filter((tagId) => idsByTag.has(tagId))
      .map((tagId) => ({ tagId, ids: idsByTag.get(tagId)! }));
  }

  // Pagina las secciones (page/limit) y los productos dentro de cada una
  // (productsPage/productsLimit); solo hidrata los productos de la ventana.
  private async buildTagSections<T>(
    groups: TagGroup[],
    query: SectionPaginationQuery,
    relations: FindOptionsRelations<Product>,
    toCard: (product: Product) => T,
  ): Promise<{
    sections: TagSection<T>[];
    pagination: SectionsPagination;
  }> {
    const windowGroups = groups.slice(
      (query.page - 1) * query.limit,
      query.page * query.limit,
    );
    const pageIdsByTag = new Map(
      windowGroups.map(({ tagId, ids }) => [
        tagId,
        ids.slice(
          (query.productsPage - 1) * query.productsLimit,
          query.productsPage * query.productsLimit,
        ),
      ]),
    );
    const pageIds = [...pageIdsByTag.values()].flat();

    const [tags, products] = await Promise.all([
      windowGroups.length === 0
        ? Promise.resolve([] as Tag[])
        : this.tagRepository.find({
            where: { tagId: In(windowGroups.map((group) => group.tagId)) },
          }),
      pageIds.length === 0
        ? Promise.resolve([] as Product[])
        : this.productRepository.find({
            where: { id: In(pageIds) },
            relations,
          }),
    ]);
    const tagById = new Map(tags.map((tag) => [tag.tagId, tag]));
    const productById = new Map(
      products.map((product) => [product.id, product]),
    );

    return {
      sections: windowGroups.map(({ tagId, ids }) => ({
        tag: { tagId, name: tagById.get(tagId)?.name ?? '' },
        totalProducts: ids.length,
        products: pageIdsByTag
          .get(tagId)!
          .map((id) => toCard(productById.get(id)!)),
        pagination: {
          page: query.productsPage,
          limit: query.productsLimit,
          totalPages: Math.ceil(ids.length / query.productsLimit),
        },
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        totalSections: groups.length,
        totalPages: Math.ceil(groups.length / query.limit),
      },
    };
  }

  private toTagProductCard(product: Product): TagProductCard {
    return {
      id: product.id,
      title: product.title,
      price: product.price,
      discountPercent: product.discountPercent,
      finalPrice: computeFinalPrice(product.price, product.discountPercent),
      currency: product.currency,
      imageUrl: product.imageUrl,
      type: product.type,
      condition: product.condition,
      isSaved: false,
      tags: product.productTags.map((productTag) => ({
        tagId: productTag.tag.tagId,
        name: productTag.tag.name,
      })),
      seller: {
        sellerId: product.seller.sellerId,
        displayName: product.seller.displayName,
        photoUrl: product.seller.user.photoUrl ?? null,
        isVerified: product.seller.isVerified,
      },
    };
  }

  // Productos del vendedor autenticado agrupados por tag. Cada producto aparece
  // una sola vez, en la primera sección (tags ordenados por cantidad de
  // productos) cuyo tag tenga. La paginación aplica dentro de cada sección.
  // Sin status trae todos, incluidos los borradores.
  async findMine(
    userId: string,
    query: GetMyProductsQueryDto,
  ): Promise<MyProductsResult> {
    const seller = await this.getSellerOrFail(userId);

    const where: FindOptionsWhere<Product> = { sellerId: seller.sellerId };
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.condition) where.condition = query.condition;
    const text = query.q ?? query.title;
    if (text) where.title = ILike(`%${escapeLike(text)}%`);
    const price = finalPriceWhere(query.priceMin, query.priceMax);
    if (price) where.price = price;

    const matching = await this.productRepository.find({
      where,
      select: { id: true, createdAt: true, productTags: { tagId: true } },
      relations: { productTags: true },
      order: { createdAt: 'DESC', id: 'DESC' },
    });

    let groups = this.groupIdsByTag(matching, this.rankTagIds(matching));
    if (query.tagId !== undefined) {
      // Con tagId se pide solo esa sección ("Show all"): se pagina su lista
      // de productos con productsPage/productsLimit.
      groups = groups.filter((group) => group.tagId === query.tagId);
    }

    const { sections, pagination } = await this.buildTagSections(
      groups,
      query,
      { productTags: { tag: true }, community: true },
      (product) => this.toMyProductCard(product),
    );

    return { totalProducts: matching.length, sections, pagination };
  }

  async countMineByStatus(userId: string): Promise<MyProductsStats> {
    const seller = await this.getSellerOrFail(userId);

    const rows = await this.productRepository
      .createQueryBuilder('product')
      .select('product.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('product.sellerId = :sellerId', { sellerId: seller.sellerId })
      .groupBy('product.status')
      .getRawMany<{ status: ProductStatus; count: string }>();

    const stats: MyProductsStats = {
      total: 0,
      draft: 0,
      active: 0,
      sold: 0,
      inactive: 0,
    };
    for (const row of rows) {
      stats[row.status] = Number(row.count);
      stats.total += Number(row.count);
    }
    return stats;
  }

  private toMyProductCard(product: Product): MyProductCard {
    return {
      id: product.id,
      title: product.title,
      price: product.price ?? null,
      discountPercent: product.discountPercent,
      finalPrice:
        product.price == null
          ? null
          : computeFinalPrice(product.price, product.discountPercent),
      currency: product.currency ?? null,
      imageUrl: product.imageUrl ?? null,
      status: product.status,
      isVisible: product.isVisible,
      publishedAt: product.publishedAt,
      type: product.type ?? null,
      condition: product.condition ?? null,
      tags: product.productTags.map((productTag) => ({
        tagId: productTag.tag.tagId,
        name: productTag.tag.name,
      })),
      community: product.community
        ? { id: product.community.id, name: product.community.name }
        : null,
    };
  }

  // Detalle: producto + precio final + rating real + datos públicos del
  // vendedor (foto y rating). Nunca expone userId ni paymentInfo del vendedor.
  // Un borrador solo lo puede ver su dueño; un producto borrado (soft delete)
  // devuelve 404.
  async findDetail(id: number, viewerId?: string) {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: { ...DETAIL_RELATIONS, seller: { user: true } },
      select: {
        seller: {
          sellerId: true,
          displayName: true,
          isVerified: true,
          userId: true,
          user: { id: true, photoUrl: true },
        },
      },
      order: { images: { order: 'ASC' } },
    });

    if (
      !product ||
      (product.status === ProductStatus.DRAFT &&
        product.seller.userId !== viewerId)
    ) {
      throw new NotFoundException('Producto no encontrado');
    }

    const [rating, sellerRatings, saved] = await Promise.all([
      this.reviewsService.getProductRating(id),
      this.usersService.getSellerRatings([product.seller.sellerId]),
      this.getSavedProductIds(viewerId, [id]),
    ]);
    const sellerRating = sellerRatings.get(product.seller.sellerId);
    // userId (y el user completo) se descartan: solo sale lo público.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { user, userId, ...seller } = product.seller;

    return {
      ...product,
      finalPrice:
        product.price == null
          ? null
          : computeFinalPrice(product.price, product.discountPercent),
      isSaved: saved.has(id),
      seller: {
        ...seller,
        photoUrl: user?.photoUrl ?? null,
        ratingAverage: sellerRating?.ratingAverage ?? null,
        reviewsCount: sellerRating?.reviewsCount ?? 0,
      },
      ratingAverage: rating.ratingAverage,
      reviewsCount: rating.reviewsCount,
    };
  }

  // Relacionados: primero los elegidos por el vendedor (solo si siguen
  // activos y visibles), luego los automáticos (tags, comunidad y, si hay
  // sesión, tags de interés del usuario), sin duplicados y con tope.
  async findRelated(
    id: number,
    viewerId?: string,
  ): Promise<(ProductListItem & { isSellerChoice: boolean })[]> {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: { productTags: true },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    const chosenLinks = await this.dataSource
      .getRepository(ProductRelated)
      .find({ where: { productId: id }, order: { id: 'ASC' } });
    const chosenIds = chosenLinks.map((link) => link.relatedProductId);

    const chosenProducts = chosenIds.length
      ? await this.productRepository.find({
          where: { id: In(chosenIds), ...PUBLIC_PRODUCT_WHERE },
          relations: { productTags: { tag: true } },
        })
      : [];
    const chosenById = new Map(chosenProducts.map((p) => [p.id, p]));
    const chosen = chosenIds
      .map((relatedId) => chosenById.get(relatedId))
      .filter((p): p is Product => p !== undefined)
      .slice(0, RELATED_PRODUCTS_LIMIT);

    const remaining = RELATED_PRODUCTS_LIMIT - chosen.length;
    let automatic: Product[] = [];

    if (remaining > 0) {
      const tagIds = new Set(
        product.productTags.map((productTag) => productTag.tagId),
      );
      if (viewerId) {
        const userTags = await this.userTagRepository.find({
          where: { userId: viewerId },
          select: { tagId: true },
        });
        userTags.forEach((userTag) => tagIds.add(userTag.tagId));
      }
      const excludedIds = [id, ...chosen.map((p) => p.id)];

      const queryBuilder = this.productRepository
        .createQueryBuilder('product')
        .leftJoin('product.productTags', 'productTag')
        .leftJoinAndSelect('product.productTags', 'allProductTags')
        .leftJoinAndSelect('allProductTags.tag', 'tag')
        .where('product.id NOT IN (:...excludedIds)', { excludedIds })
        .andWhere('product.status = :status', { status: ProductStatus.ACTIVE })
        .andWhere('product.isVisible = :isVisible', { isVisible: true })
        .andWhere(
          [
            tagIds.size > 0 ? 'productTag.tagId IN (:...tagIds)' : null,
            product.communityId !== null
              ? 'product.communityId = :communityId'
              : null,
          ]
            .filter((condition) => condition !== null)
            .join(' OR ') || 'FALSE',
          { tagIds: [...tagIds], communityId: product.communityId },
        )
        .distinct(true)
        .orderBy('product.createdAt', 'DESC')
        .take(remaining);

      automatic = await queryBuilder.getMany();
    }

    const chosenSet = new Set(chosen.map((p) => p.id));
    const items = await this.withSaved([...chosen, ...automatic], viewerId);
    return items.map((item) => ({
      ...item,
      isSellerChoice: chosenSet.has(item.id),
    }));
  }

  async update(
    id: number,
    userId: string,
    dto: UpdateProductDto,
    image: Express.Multer.File | undefined,
    images: Express.Multer.File[] | undefined,
  ) {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: { seller: true },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    if (product.seller.userId !== userId) {
      throw new ForbiddenException('No eres el dueño de este producto');
    }

    // Un producto publicado siempre conserva exactamente 3 tags; un borrador
    // puede tener menos hasta que se publique.
    if (
      dto.tagIds !== undefined &&
      product.status !== ProductStatus.DRAFT &&
      dto.tagIds.length !== 3
    ) {
      throw new BadRequestException('Debe seleccionar exactamente 3 tags');
    }

    // Mover de comunidad (número) o dejar sin comunidad (null). Para mover
    // hay que ser miembro de la comunidad destino.
    if (dto.communityId !== undefined && dto.communityId !== null) {
      await this.ensureCommunityExists(dto.communityId);
      const profile = await this.communityProfileRepository.findOne({
        where: { userId, communityId: dto.communityId },
        select: { communityProfileId: true },
      });
      if (!profile) {
        throw new ForbiddenException(
          'Debes ser miembro de la comunidad para publicar productos en ella',
        );
      }
    }

    await this.ensureTagsExist(dto.tagIds);
    const relatedIds =
      dto.relatedProductIds === undefined
        ? undefined
        : await this.validateRelatedProducts(
            product.seller.sellerId,
            dto.relatedProductIds,
            id,
          );

    const [coverUpload, galleryUploads] = await Promise.all([
      image ? this.cloudinaryService.uploadImage(image) : Promise.resolve(null),
      images && images.length > 0
        ? this.cloudinaryService.uploadImages(images)
        : Promise.resolve(null),
    ]);

    if (dto.title !== undefined) product.title = dto.title;
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.price !== undefined) product.price = dto.price;
    if (dto.type !== undefined) product.type = dto.type;
    if (dto.condition !== undefined) product.condition = dto.condition;
    if (dto.shipsTo !== undefined) product.shipsTo = dto.shipsTo;
    if (dto.discountPercent !== undefined) {
      product.discountPercent = dto.discountPercent;
    }
    if (dto.isVisible !== undefined) product.isVisible = dto.isVisible;
    if (dto.communityId !== undefined) product.communityId = dto.communityId;
    if (coverUpload) product.imageUrl = coverUpload.url;

    await this.dataSource.transaction(async (manager) => {
      await manager.save(Product, product);

      if (dto.tagIds !== undefined) {
        await manager.delete(ProductTag, { productId: id });

        if (dto.tagIds.length > 0) {
          const productTags = dto.tagIds.map((tagId) =>
            manager.create(ProductTag, { productId: id, tagId }),
          );
          await manager.save(ProductTag, productTags);
        }
      }

      if (galleryUploads) {
        await manager.delete(ProductImage, { productId: id });

        if (galleryUploads.length > 0) {
          const productImages = galleryUploads.map((upload, index) =>
            manager.create(ProductImage, {
              productId: id,
              url: upload.url,
              order: index,
            }),
          );
          await manager.save(ProductImage, productImages);
        }
      }

      if (relatedIds !== undefined) {
        await manager.delete(ProductRelated, { productId: id });

        if (relatedIds.length > 0) {
          await manager.save(
            ProductRelated,
            relatedIds.map((relatedProductId) =>
              manager.create(ProductRelated, {
                productId: id,
                relatedProductId,
              }),
            ),
          );
        }
      }
    });

    return this.findDetail(id, userId);
  }

  // Publica un borrador: valida todo (3 tags, imagen, precio, etc.), fija
  // publishedAt y lo pasa a active.
  async publish(id: number, userId: string) {
    const product = await this.getOwnedProduct(id, userId, {
      productTags: true,
    });

    if (product.status !== ProductStatus.DRAFT) {
      throw new BadRequestException('Solo se puede publicar un borrador');
    }

    const user = await this.usersService.findById(userId);
    const currency = product.currency ?? user.currency;

    this.assertPublishable({
      description: product.description,
      price: product.price,
      type: product.type,
      condition: product.condition,
      tagCount: product.productTags.length,
      hasImage: Boolean(product.imageUrl),
      currency,
    });

    product.status = ProductStatus.ACTIVE;
    product.currency = currency;
    product.publishedAt = new Date();
    await this.productRepository.save(product);
    this.eventEmitter?.emit(BadgeEvents.PRODUCT_PUBLISHED, { userId });

    return this.findDetail(id, userId);
  }

  async updateStatus(id: number, userId: string, dto: UpdateProductStatusDto) {
    const product = await this.getOwnedProduct(id, userId);

    if (product.status === ProductStatus.DRAFT) {
      if (dto.status === ProductStatus.ACTIVE) {
        return this.publish(id, userId);
      }
      throw new BadRequestException(
        'Un borrador solo se puede publicar (status active)',
      );
    }

    if (
      dto.status === ProductStatus.ACTIVE &&
      product.status !== ProductStatus.INACTIVE
    ) {
      throw new BadRequestException(
        product.status === ProductStatus.ACTIVE
          ? 'El producto ya está activo'
          : 'Solo se puede reactivar un producto inactivo',
      );
    }

    product.status = dto.status;
    await this.productRepository.save(product);

    return this.findDetail(id, userId);
  }

  // Borrado lógico: el producto desaparece de listados y detalle pero se
  // conservan favoritos y conversaciones que lo referencian.
  async remove(id: number, userId: string): Promise<void> {
    await this.getOwnedProduct(id, userId);
    await this.productRepository.softDelete(id);
  }

  // Registra que el usuario vio el producto (alimenta /products/recommended).
  // No cuenta borradores ni las vistas del propio vendedor.
  async recordView(productId: number, userId: string): Promise<void> {
    const product = await this.productRepository.findOne({
      where: { id: productId },
      relations: { seller: true },
      select: {
        id: true,
        status: true,
        seller: { sellerId: true, userId: true },
      },
    });
    if (!product || product.status === ProductStatus.DRAFT) {
      throw new NotFoundException('Producto no encontrado');
    }
    if (product.seller.userId === userId) return;

    await this.productViewRepository.upsert(
      { userId, productId, viewedAt: new Date() },
      ['userId', 'productId'],
    );
  }

  /**
   * Coincidencia simple por tags (sin ML): combina los tags de interés del
   * usuario, los de los últimos 10 productos que vio (guardados en el
   * servidor si hay sesión; recentProductIds si no la hay) y los
   * tags/comunidad del producto que se está viendo (currentProductId). Sin
   * ninguna señal, cae a los productos activos más recientes.
   */
  async findRecommended(
    userId: string | undefined,
    query: GetRecommendedProductsQueryDto,
  ): Promise<ProductListItem[]> {
    const tagIds = new Set<number>();
    let communityId: number | undefined;
    let excludeId: number | undefined;

    if (userId) {
      const userTags = await this.userTagRepository.find({
        where: { userId },
        select: { tagId: true },
      });
      userTags.forEach((userTag) => tagIds.add(userTag.tagId));
    }

    const recentIds = userId
      ? (
          await this.productViewRepository.find({
            where: { userId },
            order: { viewedAt: 'DESC' },
            take: 10,
            select: { productId: true },
          })
        ).map((view) => view.productId)
      : (query.recentProductIds ?? []);
    if (recentIds.length > 0) {
      const recentProducts = await this.productRepository.find({
        where: { id: In(recentIds) },
        relations: { productTags: true },
      });
      recentProducts.forEach((recent) =>
        recent.productTags.forEach((productTag) =>
          tagIds.add(productTag.tagId),
        ),
      );
    }

    if (query.currentProductId !== undefined) {
      const currentProduct = await this.productRepository.findOne({
        where: { id: query.currentProductId },
        relations: { productTags: true },
      });

      if (currentProduct) {
        excludeId = currentProduct.id;
        communityId = currentProduct.communityId ?? undefined;
        currentProduct.productTags.forEach((productTag) =>
          tagIds.add(productTag.tagId),
        );
      }
    }

    if (tagIds.size === 0 && communityId === undefined) {
      const latest = await this.productRepository.find({
        where: { ...PUBLIC_PRODUCT_WHERE },
        relations: { productTags: { tag: true } },
        order: { createdAt: 'DESC' },
        take: query.limit,
      });
      return this.withSaved(latest, userId);
    }

    const queryBuilder = this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.productTags', 'allProductTags')
      .leftJoinAndSelect('allProductTags.tag', 'tag')
      .where('product.status = :status', { status: ProductStatus.ACTIVE })
      .andWhere('product.isVisible = :isVisible', { isVisible: true });

    if (excludeId !== undefined) {
      queryBuilder.andWhere('product.id != :excludeId', { excludeId });
    }

    const matchConditions: string[] = [];
    if (tagIds.size > 0) {
      queryBuilder.leftJoin('product.productTags', 'matchTag');
      matchConditions.push('matchTag.tagId IN (:...tagIds)');
    }
    if (communityId !== undefined) {
      matchConditions.push('product.communityId = :communityId');
    }

    queryBuilder.andWhere(`(${matchConditions.join(' OR ')})`, {
      tagIds: [...tagIds],
      communityId,
    });

    const products = await queryBuilder
      .distinct(true)
      .orderBy('product.createdAt', 'DESC')
      .take(query.limit)
      .getMany();

    return this.withSaved(products, userId);
  }

  // Ids de productos guardados (favoritos) por el usuario, en una sola
  // consulta. Sin sesión devuelve un conjunto vacío.
  async getSavedProductIds(
    userId: string | undefined,
    productIds: number[],
  ): Promise<Set<number>> {
    if (!userId || productIds.length === 0) return new Set();

    const favorites = await this.favoriteRepository.find({
      where: {
        userId,
        itemType: FavoriteItemType.PRODUCT,
        itemId: In(productIds),
      },
      select: { itemId: true },
    });
    return new Set(favorites.map((favorite) => favorite.itemId));
  }

  // Agrega finalPrice e isSaved a una lista de productos.
  private async withSaved(
    products: Product[],
    viewerId: string | undefined,
  ): Promise<ProductListItem[]> {
    const saved = await this.getSavedProductIds(
      viewerId,
      products.map((product) => product.id),
    );
    return products.map((product) => ({
      ...product,
      finalPrice: computeFinalPrice(product.price, product.discountPercent),
      isSaved: saved.has(product.id),
    }));
  }

  private async getSellerOrFail(userId: string): Promise<Seller> {
    const seller = await this.sellerRepository.findOne({ where: { userId } });
    if (!seller) {
      throw new ForbiddenException(
        'Solo los vendedores pueden ver sus productos',
      );
    }
    return seller;
  }

  private async getOwnedProduct(
    id: number,
    userId: string,
    relations: FindOptionsRelations<Product> = {},
  ): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: { seller: true, ...relations },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    if (product.seller.userId !== userId) {
      throw new ForbiddenException('No eres el dueño de este producto');
    }

    return product;
  }

  // Publicar exige todos los datos; un borrador puede estar incompleto.
  private assertPublishable(fields: PublishableFields): void {
    const missing: string[] = [];
    if (!fields.description) missing.push('description es obligatorio');
    if (fields.price == null) missing.push('price es obligatorio');
    if (!fields.type) missing.push('type es obligatorio');
    if (!fields.condition) missing.push('condition es obligatorio');
    if (fields.tagCount !== 3) {
      missing.push('Debe seleccionar exactamente 3 tags');
    }
    if (!fields.hasImage) {
      missing.push('Debe proporcionar una imagen de portada');
    }
    if (!fields.currency) {
      missing.push(
        'Configura tu moneda (currency) en tu perfil antes de publicar productos',
      );
    }

    if (missing.length > 0) {
      throw new BadRequestException(missing);
    }
  }

  // Los relacionados deben ser del mismo vendedor, estar activos y no ser el
  // propio producto (el tope de 6 lo valida el DTO).
  private async validateRelatedProducts(
    sellerId: number,
    relatedIds: number[] | undefined,
    selfId?: number,
  ): Promise<number[]> {
    if (!relatedIds || relatedIds.length === 0) return [];

    if (selfId !== undefined && relatedIds.includes(selfId)) {
      throw new BadRequestException(
        'Un producto no puede ser relacionado de sí mismo',
      );
    }

    const found = await this.productRepository.find({
      where: { id: In(relatedIds) },
      select: { id: true, sellerId: true, status: true },
    });
    const foundIds = new Set(found.map((product) => product.id));
    const missing = relatedIds.filter((relatedId) => !foundIds.has(relatedId));
    if (missing.length > 0) {
      throw new NotFoundException(
        `No existen los siguientes productos relacionados: ${missing.join(', ')}`,
      );
    }

    const invalid = found.filter(
      (product) =>
        product.sellerId !== sellerId ||
        product.status !== ProductStatus.ACTIVE,
    );
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Los productos relacionados deben ser tuyos y estar activos: ${invalid
          .map((product) => product.id)
          .join(', ')}`,
      );
    }

    return relatedIds;
  }

  private async ensureCommunityExists(communityId: number): Promise<void> {
    const community = await this.communityRepository.findOne({
      where: { id: communityId },
      select: { id: true },
    });

    if (!community) {
      throw new NotFoundException('Comunidad no encontrada');
    }
  }

  private async ensureTagsExist(tagIds: number[] | undefined): Promise<void> {
    if (!tagIds || tagIds.length === 0) return;

    const existingTags = await this.tagRepository.find({
      where: { tagId: In(tagIds) },
    });
    const existingTagIds = new Set(existingTags.map((tag) => tag.tagId));
    const missingTagIds = tagIds.filter((tagId) => !existingTagIds.has(tagId));

    if (missingTagIds.length > 0) {
      throw new NotFoundException(
        `No existen los siguientes tags: ${missingTagIds.join(', ')}`,
      );
    }
  }

  private buildPagination(page: number, limit: number, total: number) {
    return {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }
}
