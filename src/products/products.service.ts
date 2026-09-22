import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Community } from '../community/entities/community.entity';
import { Tag } from '../community/entities/tag.entity';
import { Seller } from '../sellers/entities/seller.entity';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UsersService } from '../users/users.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductStatusDto } from './dto/update-product-status.dto';
import { GetCommunityProductsQueryDto } from './dto/get-community-products-query.dto';
import { ExploreProductsQueryDto } from './dto/explore-products-query.dto';
import { Product, ProductStatus } from './entities/product.entity';
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

  async findAllByCommunity(
    communityId: number,
    query: GetCommunityProductsQueryDto,
  ): Promise<Paginated<Product>> {
    await this.ensureCommunityExists(communityId);

    const [data, total] = await this.productRepository.findAndCount({
      where: { communityId, status: ProductStatus.ACTIVE },
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
      select: { seller: { sellerId: true, userId: true } },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    if (product.seller.userId !== userId) {
      throw new ForbiddenException('No eres el dueño de este producto');
    }

    product.status = dto.status;
    await this.productRepository.save(product);

    return this.findOne(id);
  }

  async findByTag(query: ExploreProductsQueryDto): Promise<Paginated<Product>> {
    const [data, total] = await this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.productTags', 'productTag')
      .leftJoinAndSelect('productTag.tag', 'tag')
      .innerJoin('product.productTags', 'matchingTag')
      .where('matchingTag.tagId = :tagId', { tagId: query.tagId })
      .andWhere('product.status = :status', { status: ProductStatus.ACTIVE })
      .orderBy('product.createdAt', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    return {
      data,
      pagination: this.buildPagination(query.page, query.limit, total),
    };
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
