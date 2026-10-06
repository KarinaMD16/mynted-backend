import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  And,
  DataSource,
  FindOptionsRelations,
  FindOptionsWhere,
  ILike,
  In,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { Community } from '../community/entities/community.entity';
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

const RELATED_PRODUCTS_LIMIT = 4;
const DEFAULT_CURRENCY = 'USD';

const DETAIL_RELATIONS = {
  seller: true,
  productTags: { tag: true },
  images: true,
};

// El detalle del vendedor nunca debe incluir paymentInfo ni otros datos
// sensibles (userId, paymentId): solo lo que el frontend necesita mostrar.
const DETAIL_SELECT = {
  seller: {
    sellerId: true,
    displayName: true,
    isVerified: true,
  },
};

export interface TagProductCard {
  id: number;
  title: string;
  price: number;
  currency: string;
  imageUrl: string;
  type: ProductType;
  condition: ProductCondition;
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
  price: number;
  currency: string;
  imageUrl: string;
  status: ProductStatus;
  type: ProductType;
  condition: ProductCondition;
  tags: { tagId: number; name: string }[];
  community: { id: number; name: string };
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

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Seller)
    private readonly sellerRepository: Repository<Seller>,
    @InjectRepository(Community)
    private readonly communityRepository: Repository<Community>,
    @InjectRepository(Tag)
    private readonly tagRepository: Repository<Tag>,
    @InjectRepository(UserTag)
    private readonly userTagRepository: Repository<UserTag>,
    private readonly usersService: UsersService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    communityId: number,
    userId: string,
    dto: CreateProductDto,
    image: Express.Multer.File | undefined,
    images: Express.Multer.File[] | undefined,
  ): Promise<Product> {
    if (!image) {
      throw new BadRequestException('Debe proporcionar una imagen de portada');
    }

    await this.ensureCommunityExists(communityId);

    const seller = await this.sellerRepository.findOne({ where: { userId } });
    if (!seller) {
      throw new ForbiddenException(
        'Debes completar tu activación de vendedor antes de publicar productos',
      );
    }

    await this.ensureTagsExist(dto.tagIds);

    const user = await this.usersService.findById(userId);
    const currency = user.currency ?? DEFAULT_CURRENCY;

    const [coverUpload, galleryUploads] = await Promise.all([
      this.cloudinaryService.uploadImage(image),
      images && images.length > 0
        ? this.cloudinaryService.uploadImages(images)
        : Promise.resolve([]),
    ]);

    return this.dataSource.transaction(async (manager) => {
      const product = manager.create(Product, {
        title: dto.title,
        description: dto.description,
        price: dto.price,
        currency,
        imageUrl: coverUpload.url,
        status: ProductStatus.ACTIVE,
        type: dto.type,
        condition: dto.condition,
        sellerId: seller.sellerId,
        communityId,
      });
      const savedProduct = await manager.save(Product, product);

      const productTags = dto.tagIds.map((tagId) =>
        manager.create(ProductTag, { productId: savedProduct.id, tagId }),
      );
      await manager.save(ProductTag, productTags);

      if (galleryUploads.length > 0) {
        const productImages = galleryUploads.map((upload, index) =>
          manager.create(ProductImage, {
            productId: savedProduct.id,
            url: upload.url,
            order: index,
          }),
        );
        await manager.save(ProductImage, productImages);
      }

      const result = await manager.findOne(Product, {
        where: { id: savedProduct.id },
        relations: DETAIL_RELATIONS,
        select: DETAIL_SELECT,
      });

      if (!result) {
        throw new NotFoundException(
          'No fue posible recuperar el producto creado',
        );
      }

      return result;
    });
  }

  async findAll(query: GetProductsQueryDto): Promise<Paginated<Product>> {
    // Usa la API de repository (no QueryBuilder) a propósito: con relaciones
    // "to-many" (productTags), TypeORM pagina correctamente los productos
    // raíz primero y luego hidrata las relaciones, evitando que un producto
    // con varios tags rompa el skip/take.
    const where: FindOptionsWhere<Product> = {
      status: ProductStatus.ACTIVE,
    };

    if (query.communityId !== undefined) where.communityId = query.communityId;
    if (query.type !== undefined) where.type = query.type;
    if (query.condition !== undefined) where.condition = query.condition;
    if (query.category !== undefined) {
      where.community = { categoryId: query.category };
    }
    if (query.tag !== undefined) {
      where.productTags = { tagId: query.tag };
    }
    if (query.priceMin !== undefined && query.priceMax !== undefined) {
      where.price = And(
        MoreThanOrEqual(query.priceMin),
        LessThanOrEqual(query.priceMax),
      );
    } else if (query.priceMin !== undefined) {
      where.price = MoreThanOrEqual(query.priceMin);
    } else if (query.priceMax !== undefined) {
      where.price = LessThanOrEqual(query.priceMax);
    }

    const [data, total] = await this.productRepository.findAndCount({
      where,
      relations: { productTags: { tag: true } },
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      data,
      pagination: this.buildPagination(query.page, query.limit, total),
    };
  }

  /**
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
      where: { status: ProductStatus.ACTIVE },
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
      currency: product.currency,
      imageUrl: product.imageUrl,
      type: product.type,
      condition: product.condition,
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
  async findMine(
    userId: string,
    query: GetMyProductsQueryDto,
  ): Promise<MyProductsResult> {
    const seller = await this.sellerRepository.findOne({ where: { userId } });
    if (!seller) {
      throw new ForbiddenException(
        'Solo los vendedores pueden ver sus productos',
      );
    }

    const where: FindOptionsWhere<Product> = { sellerId: seller.sellerId };
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.condition) where.condition = query.condition;
    if (query.title) {
      const escaped = query.title.replace(/[\\%_]/g, (char) => `\\${char}`);
      where.title = ILike(`%${escaped}%`);
    }
    if (query.priceMin !== undefined && query.priceMax !== undefined) {
      where.price = And(
        MoreThanOrEqual(query.priceMin),
        LessThanOrEqual(query.priceMax),
      );
    } else if (query.priceMin !== undefined) {
      where.price = MoreThanOrEqual(query.priceMin);
    } else if (query.priceMax !== undefined) {
      where.price = LessThanOrEqual(query.priceMax);
    }

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
    const seller = await this.sellerRepository.findOne({ where: { userId } });
    if (!seller) {
      throw new ForbiddenException(
        'Solo los vendedores pueden ver sus productos',
      );
    }

    const rows = await this.productRepository
      .createQueryBuilder('product')
      .select('product.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('product.sellerId = :sellerId', { sellerId: seller.sellerId })
      .groupBy('product.status')
      .getRawMany<{ status: ProductStatus; count: string }>();

    const stats: MyProductsStats = {
      total: 0,
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
      price: product.price,
      currency: product.currency,
      imageUrl: product.imageUrl,
      status: product.status,
      type: product.type,
      condition: product.condition,
      tags: product.productTags.map((productTag) => ({
        tagId: productTag.tag.tagId,
        name: productTag.tag.name,
      })),
      community: { id: product.community.id, name: product.community.name },
    };
  }

  async findOne(id: number): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: DETAIL_RELATIONS,
      select: DETAIL_SELECT,
      order: { images: { order: 'ASC' } },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    return product;
  }

  async findRelated(id: number): Promise<Product[]> {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: { productTags: true },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    const tagIds = product.productTags.map((productTag) => productTag.tagId);

    const queryBuilder = this.productRepository
      .createQueryBuilder('product')
      .leftJoin('product.productTags', 'productTag')
      .leftJoinAndSelect('product.productTags', 'allProductTags')
      .leftJoinAndSelect('allProductTags.tag', 'tag')
      .where('product.id != :id', { id })
      .andWhere('product.status = :status', { status: ProductStatus.ACTIVE })
      .andWhere(
        tagIds.length > 0
          ? '(productTag.tagId IN (:...tagIds) OR product.communityId = :communityId)'
          : 'product.communityId = :communityId',
        { tagIds, communityId: product.communityId },
      )
      .distinct(true)
      .orderBy('product.createdAt', 'DESC')
      .take(RELATED_PRODUCTS_LIMIT);

    return queryBuilder.getMany();
  }

  async update(
    id: number,
    userId: string,
    dto: UpdateProductDto,
    image: Express.Multer.File | undefined,
    images: Express.Multer.File[] | undefined,
  ): Promise<Product> {
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

    await this.ensureTagsExist(dto.tagIds);

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
    if (coverUpload) product.imageUrl = coverUpload.url;

    return this.dataSource.transaction(async (manager) => {
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

      const result = await manager.findOne(Product, {
        where: { id },
        relations: DETAIL_RELATIONS,
        select: DETAIL_SELECT,
        order: { images: { order: 'ASC' } },
      });

      if (!result) {
        throw new NotFoundException(
          'No fue posible recuperar el producto actualizado',
        );
      }

      return result;
    });
  }

  async updateStatus(
    id: number,
    userId: string,
    dto: UpdateProductStatusDto,
  ): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: { seller: true },
      select: {
        id: true,
        status: true,
        seller: { sellerId: true, userId: true },
      },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    if (product.seller.userId !== userId) {
      throw new ForbiddenException('No eres el dueño de este producto');
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

    return this.findOne(id);
  }

  /**
   * Coincidencia simple (no scoring): combina los tags que sigue el usuario
   * autenticado (si hay uno) con los tags/comunidad del producto que se
   * está viendo (si se pasa currentProductId). Sin ninguna de las dos
   * señales, cae a los productos activos más recientes.
   */
  async findRecommended(
    userId: string | undefined,
    query: GetRecommendedProductsQueryDto,
  ): Promise<Product[]> {
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

    if (query.currentProductId !== undefined) {
      const currentProduct = await this.productRepository.findOne({
        where: { id: query.currentProductId },
        relations: { productTags: true },
      });

      if (currentProduct) {
        excludeId = currentProduct.id;
        communityId = currentProduct.communityId;
        currentProduct.productTags.forEach((productTag) =>
          tagIds.add(productTag.tagId),
        );
      }
    }

    if (tagIds.size === 0 && communityId === undefined) {
      return this.productRepository.find({
        where: { status: ProductStatus.ACTIVE },
        relations: { productTags: { tag: true } },
        order: { createdAt: 'DESC' },
        take: query.limit,
      });
    }

    const queryBuilder = this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.productTags', 'allProductTags')
      .leftJoinAndSelect('allProductTags.tag', 'tag')
      .where('product.status = :status', { status: ProductStatus.ACTIVE });

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

    return queryBuilder
      .distinct(true)
      .orderBy('product.createdAt', 'DESC')
      .take(query.limit)
      .getMany();
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
