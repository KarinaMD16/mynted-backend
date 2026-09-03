import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { CreateCommunityRuleDto } from './dto/create-community-rule.dto';
import { CreateTagDto } from './dto/create-tag.dto';
import { GetTagsQueryDto } from './dto/get-tags-query.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';
import { UpdateCommunityRuleDto } from './dto/update-community-rule.dto';
import { Category } from './entities/category.entity';
import { CommunityRule } from './entities/community-rule.entity';
import { CommunityTag } from './entities/community-tag.entity';
import { Community } from './entities/community.entity';
import { Tag } from './entities/tag.entity';

interface PostgresError {
  code?: string;
  constraint?: string;
}

type CommunityRuleSummary = Pick<
  CommunityRule,
  'communityRuleId' | 'description'
>;

@Injectable()
export class CommunityService {
  constructor(
    @InjectRepository(Community)
    private readonly communityRepository: Repository<Community>,
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(Tag)
    private readonly tagRepository: Repository<Tag>,
    @InjectRepository(CommunityRule)
    private readonly communityRuleRepository: Repository<CommunityRule>,
    private readonly dataSource: DataSource,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async create(
    dto: CreateCommunityDto,
    image: Express.Multer.File | undefined,
    banner: Express.Multer.File | undefined,
  ): Promise<Community> {
    this.validateCollections(dto);

    const [communityWithName, communityWithSlug, category, tags] =
      await Promise.all([
        this.communityRepository.findOne({ where: { name: dto.name } }),
        this.communityRepository.findOne({ where: { slug: dto.slug } }),
        this.categoryRepository.findOne({
          where: { categoryId: dto.categoryId },
        }),
        this.tagRepository.find({ where: { tagId: In(dto.tagIds) } }),
      ]);

    if (communityWithName) {
      throw new ConflictException('Ya existe una comunidad con ese nombre');
    }

    if (communityWithSlug) {
      throw new ConflictException('Ya existe una comunidad con ese slug');
    }

    if (!category) {
      throw new NotFoundException('La categoría seleccionada no existe');
    }

    const existingTagIds = new Set(tags.map((tag) => tag.tagId));
    const missingTagIds = dto.tagIds.filter(
      (tagId) => !existingTagIds.has(tagId),
    );

    if (missingTagIds.length > 0) {
      throw new NotFoundException(
        `No existen los siguientes tags: ${missingTagIds.join(', ')}`,
      );
    }

    if (!image || !banner) {
      throw new BadRequestException(
        'Debe proporcionar la imagen y el banner de la comunidad',
      );
    }

    const [imageUpload, bannerUpload] = await this.uploadImages([
      image,
      banner,
    ]);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const community = manager.create(Community, {
          name: dto.name,
          description: dto.description,
          slug: dto.slug,
          isActive: true,
          isPrivate: dto.isPrivate,
          imageUrl: imageUpload.url,
          bannerUrl: bannerUpload.url,
          categoryId: dto.categoryId,
        });

        const savedCommunity = await manager.save(Community, community);

        const communityTags = dto.tagIds.map((tagId) =>
          manager.create(CommunityTag, {
            communityId: savedCommunity.id,
            tagId,
          }),
        );
        await manager.save(CommunityTag, communityTags);

        const communityRules = dto.rules.map((description) =>
          manager.create(CommunityRule, {
            communityId: savedCommunity.id,
            description,
          }),
        );

        if (communityRules.length > 0) {
          await manager.save(CommunityRule, communityRules);
        }

        const result = await manager.findOne(Community, {
          where: { id: savedCommunity.id },
          relations: {
            category: true,
            communityTags: { tag: true },
            rules: true,
          },
        });

        if (!result) {
          throw new InternalServerErrorException(
            'No fue posible recuperar la comunidad creada',
          );
        }

        return result;
      });
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  findAllCategories(): Promise<Category[]> {
    return this.categoryRepository.find({ order: { categoryId: 'ASC' } });
  }

  async createTag(dto: CreateTagDto): Promise<Tag> {
    const existingTag = await this.tagRepository.findOne({
      where: { name: dto.name },
    });

    if (existingTag) {
      throw new ConflictException('Ya existe un tag con ese nombre');
    }

    try {
      return await this.tagRepository.save(
        this.tagRepository.create({ name: dto.name }),
      );
    } catch (error: unknown) {
      if (error instanceof QueryFailedError) {
        const databaseError = error.driverError as PostgresError;

        if (
          databaseError.code === '23505' &&
          databaseError.constraint === 'UQ_tag_name'
        ) {
          throw new ConflictException('Ya existe un tag con ese nombre');
        }
      }

      throw new InternalServerErrorException(
        'Ocurrió un error al crear el tag',
      );
    }
  }

  async findAllTags(query: GetTagsQueryDto) {
    const { page, limit } = query;
    const [data, total] = await this.tagRepository.findAndCount({
      order: { tagId: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findAllRules(communityId: number): Promise<CommunityRuleSummary[]> {
    await this.ensureCommunityExists(communityId);

    return this.communityRuleRepository.find({
      where: { communityId },
      select: {
        communityRuleId: true,
        description: true,
      },
      order: { communityRuleId: 'ASC' },
    });
  }

  async createRule(
    communityId: number,
    dto: CreateCommunityRuleDto,
  ): Promise<CommunityRule[]> {
    await this.ensureCommunityExists(communityId);

    if (new Set(dto.description).size !== dto.description.length) {
      throw new ConflictException(
        'No puede repetir reglas en la misma petición',
      );
    }

    const duplicateRules = await this.communityRuleRepository.find({
      where: { communityId, description: In(dto.description) },
    });

    if (duplicateRules.length > 0) {
      throw new ConflictException(
        'La comunidad ya tiene una regla con esa descripción',
      );
    }

    const rules = dto.description.map((description) =>
      this.communityRuleRepository.create({
        communityId,
        description,
      }),
    );

    try {
      return await this.dataSource.transaction((manager) =>
        manager.save(CommunityRule, rules),
      );
    } catch (error: unknown) {
      this.handleCommunityRuleDatabaseError(error, 'crear');
    }
  }

  async updateRule(
    communityId: number,
    ruleId: number,
    dto: UpdateCommunityRuleDto,
  ): Promise<CommunityRule> {
    await this.ensureCommunityExists(communityId);

    const rule = await this.communityRuleRepository.findOne({
      where: { communityRuleId: ruleId, communityId },
    });

    if (!rule) {
      throw new NotFoundException('Regla no encontrada en esta comunidad');
    }

    const duplicateRule = await this.communityRuleRepository.findOne({
      where: { communityId, description: dto.description },
    });

    if (duplicateRule && duplicateRule.communityRuleId !== ruleId) {
      throw new ConflictException(
        'La comunidad ya tiene una regla con esa descripción',
      );
    }

    rule.description = dto.description;

    try {
      return await this.communityRuleRepository.save(rule);
    } catch (error: unknown) {
      this.handleCommunityRuleDatabaseError(error, 'actualizar');
    }
  }

  async deleteRule(
    communityId: number,
    ruleId: number,
  ): Promise<{ message: string }> {
    await this.ensureCommunityExists(communityId);

    const rule = await this.communityRuleRepository.findOne({
      where: { communityRuleId: ruleId, communityId },
    });

    if (!rule) {
      throw new NotFoundException('Regla no encontrada en esta comunidad');
    }

    try {
      await this.communityRuleRepository.remove(rule);
      return { message: 'Regla eliminada exitosamente' };
    } catch {
      throw new InternalServerErrorException(
        'Ocurrió un error al eliminar la regla',
      );
    }
  }

  async update(
    id: number,
    dto: UpdateCommunityDto,
    image: Express.Multer.File | undefined,
    banner: Express.Multer.File | undefined,
  ): Promise<Community> {
    const community = await this.communityRepository.findOne({
      where: { id },
    });

    if (!community) {
      throw new NotFoundException('Comunidad no encontrada');
    }

    this.validateUpdateCollections(dto);

    const [communityWithName, category, tags] = await Promise.all([
      dto.name !== undefined
        ? this.communityRepository.findOne({ where: { name: dto.name } })
        : Promise.resolve(null),
      dto.categoryId !== undefined
        ? this.categoryRepository.findOne({
            where: { categoryId: dto.categoryId },
          })
        : Promise.resolve(null),
      dto.tagIds !== undefined
        ? this.tagRepository.find({ where: { tagId: In(dto.tagIds) } })
        : Promise.resolve([] as Tag[]),
    ]);

    if (communityWithName && communityWithName.id !== id) {
      throw new ConflictException('Ya existe una comunidad con ese nombre');
    }

    if (dto.categoryId !== undefined && !category) {
      throw new NotFoundException('La categoría seleccionada no existe');
    }

    if (dto.tagIds !== undefined) {
      const existingTagIds = new Set(tags.map((tag) => tag.tagId));
      const missingTagIds = dto.tagIds.filter(
        (tagId) => !existingTagIds.has(tagId),
      );

      if (missingTagIds.length > 0) {
        throw new NotFoundException(
          `No existen los siguientes tags: ${missingTagIds.join(', ')}`,
        );
      }
    }

    let newImageUrl: string | undefined;
    let newBannerUrl: string | undefined;
    const filesToUpload: Express.Multer.File[] = [];

    if (image) filesToUpload.push(image);
    if (banner) filesToUpload.push(banner);

    if (filesToUpload.length > 0) {
      const uploads = await this.uploadImages(filesToUpload);
      let uploadIndex = 0;

      if (image) {
        newImageUrl = uploads[uploadIndex].url;
        uploadIndex += 1;
      }

      if (banner) {
        newBannerUrl = uploads[uploadIndex].url;
      }
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const currentCommunity = await manager.findOne(Community, {
          where: { id },
        });

        if (!currentCommunity) {
          throw new NotFoundException('Comunidad no encontrada');
        }

        if (dto.name !== undefined) currentCommunity.name = dto.name;
        if (dto.description !== undefined) {
          currentCommunity.description = dto.description;
        }
        if (dto.categoryId !== undefined) {
          currentCommunity.categoryId = dto.categoryId;
        }
        if (newImageUrl !== undefined) {
          currentCommunity.imageUrl = newImageUrl;
        }
        if (newBannerUrl !== undefined) {
          currentCommunity.bannerUrl = newBannerUrl;
        }

        await manager.save(Community, currentCommunity);

        if (dto.tagIds !== undefined) {
          await manager.delete(CommunityTag, { communityId: id });

          const communityTags = dto.tagIds.map((tagId) =>
            manager.create(CommunityTag, { communityId: id, tagId }),
          );
          await manager.save(CommunityTag, communityTags);
        }

        if (dto.rules !== undefined) {
          await manager.delete(CommunityRule, { communityId: id });

          const communityRules = dto.rules.map((description) =>
            manager.create(CommunityRule, {
              communityId: id,
              description,
            }),
          );

          if (communityRules.length > 0) {
            await manager.save(CommunityRule, communityRules);
          }
        }

        const result = await manager.findOne(Community, {
          where: { id },
          relations: {
            category: true,
            communityTags: { tag: true },
            rules: true,
          },
        });

        if (!result) {
          throw new InternalServerErrorException(
            'No fue posible recuperar la comunidad actualizada',
          );
        }

        return result;
      });
    } catch (error: unknown) {
      this.handleUpdateDatabaseError(error);
    }
  }

  async deactivate(id: number): Promise<{ message: string }> {
    const community = await this.communityRepository.findOne({
      where: { id },
    });

    if (!community) {
      throw new NotFoundException('Comunidad no encontrada');
    }

    if (!community.isActive) {
      return { message: 'Comunidad desactivada exitosamente' };
    }

    community.isActive = false;

    try {
      await this.communityRepository.save(community);
      return { message: 'Comunidad desactivada exitosamente' };
    } catch {
      throw new InternalServerErrorException(
        'Ocurrió un error al desactivar la comunidad',
      );
    }
  }

  async activate(id: number): Promise<{ message: string }> {
    const community = await this.communityRepository.findOne({
      where: { id },
    });

    if (!community) {
      throw new NotFoundException('Comunidad no encontrada');
    }

    if (community.isActive) {
      return { message: 'Comunidad activada exitosamente' };
    }

    community.isActive = true;

    try {
      await this.communityRepository.save(community);
      return { message: 'Comunidad activada exitosamente' };
    } catch {
      throw new InternalServerErrorException(
        'Ocurrió un error al activar la comunidad',
      );
    }
  }

  async makePublic(id: number): Promise<{ message: string }> {
    const community = await this.communityRepository.findOne({
      where: { id },
    });

    if (!community) {
      throw new NotFoundException('Comunidad no encontrada');
    }

    if (!community.isPrivate) {
      return { message: 'Comunidad configurada como pública exitosamente' };
    }

    community.isPrivate = false;

    try {
      await this.communityRepository.save(community);
      return { message: 'Comunidad configurada como pública exitosamente' };
    } catch {
      throw new InternalServerErrorException(
        'Ocurrió un error al cambiar la comunidad a pública',
      );
    }
  }

  async makePrivate(id: number): Promise<{ message: string }> {
    const community = await this.communityRepository.findOne({
      where: { id },
    });

    if (!community) {
      throw new NotFoundException('Comunidad no encontrada');
    }

    if (community.isPrivate) {
      return { message: 'Comunidad configurada como privada exitosamente' };
    }

    community.isPrivate = true;

    try {
      await this.communityRepository.save(community);
      return { message: 'Comunidad configurada como privada exitosamente' };
    } catch {
      throw new InternalServerErrorException(
        'Ocurrió un error al cambiar la comunidad a privada',
      );
    }
  }

  private validateCollections(dto: CreateCommunityDto): void {
    if (dto.tagIds.length < 1 || dto.tagIds.length > 3) {
      throw new BadRequestException(
        'Una comunidad debe tener entre uno y tres tags',
      );
    }

    if (new Set(dto.tagIds).size !== dto.tagIds.length) {
      throw new BadRequestException('No puede repetir tags en una comunidad');
    }

    if (new Set(dto.rules).size !== dto.rules.length) {
      throw new BadRequestException('No puede repetir reglas en una comunidad');
    }
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

  private validateUpdateCollections(dto: UpdateCommunityDto): void {
    if (
      dto.tagIds !== undefined &&
      (dto.tagIds.length < 1 || dto.tagIds.length > 3)
    ) {
      throw new BadRequestException(
        'Una comunidad debe tener entre uno y tres tags',
      );
    }

    if (
      dto.tagIds !== undefined &&
      new Set(dto.tagIds).size !== dto.tagIds.length
    ) {
      throw new BadRequestException('No puede repetir tags en una comunidad');
    }

    if (
      dto.rules !== undefined &&
      new Set(dto.rules).size !== dto.rules.length
    ) {
      throw new BadRequestException('No puede repetir reglas en una comunidad');
    }
  }

  private async uploadImages(
    files: Express.Multer.File[],
  ): Promise<{ url: string }[]> {
    try {
      return await this.cloudinaryService.uploadImages(files);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;

      throw new BadGatewayException(
        'No fue posible subir las imágenes de la comunidad',
      );
    }
  }

  private handleDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;

    if (error instanceof QueryFailedError) {
      const databaseError = error.driverError as PostgresError;

      if (databaseError.code === '23505') {
        if (databaseError.constraint === 'UQ_community_name') {
          throw new ConflictException('Ya existe una comunidad con ese nombre');
        }

        if (databaseError.constraint === 'UQ_community_slug') {
          throw new ConflictException('Ya existe una comunidad con ese slug');
        }

        if (
          databaseError.constraint === 'UQ_community_tag_community_id_tag_id'
        ) {
          throw new BadRequestException(
            'No puede repetir tags en una comunidad',
          );
        }

        throw new ConflictException(
          'No fue posible crear la comunidad debido a datos duplicados',
        );
      }
    }

    throw new InternalServerErrorException(
      'Ocurrió un error al crear la comunidad',
    );
  }

  private handleUpdateDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;

    if (error instanceof QueryFailedError) {
      const databaseError = error.driverError as PostgresError;

      if (databaseError.code === '23505') {
        if (databaseError.constraint === 'UQ_community_name') {
          throw new ConflictException('Ya existe una comunidad con ese nombre');
        }

        if (
          databaseError.constraint === 'UQ_community_tag_community_id_tag_id'
        ) {
          throw new BadRequestException(
            'No puede repetir tags en una comunidad',
          );
        }

        throw new ConflictException(
          'No fue posible actualizar la comunidad debido a datos duplicados',
        );
      }
    }

    throw new InternalServerErrorException(
      'Ocurrió un error al actualizar la comunidad',
    );
  }

  private handleCommunityRuleDatabaseError(
    error: unknown,
    action: 'crear' | 'actualizar',
  ): never {
    if (error instanceof QueryFailedError) {
      const databaseError = error.driverError as PostgresError;

      if (
        databaseError.code === '23505' &&
        databaseError.constraint ===
          'UQ_community_rule_community_id_description'
      ) {
        throw new ConflictException(
          'La comunidad ya tiene una regla con esa descripción',
        );
      }
    }

    throw new InternalServerErrorException(
      `Ocurrió un error al ${action} la regla`,
    );
  }
}
