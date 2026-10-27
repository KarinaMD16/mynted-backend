import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import 'multer';
import { In, Repository } from 'typeorm';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { ProStatusService } from '../pro-status/pro-status.service';
import { toStaticImageUrl } from './banner-urls';
import {
  CosmeticLike,
  EffectiveCosmetics,
  resolveCosmetics,
  resolveEffective,
} from './cosmetic-resolve';
import { CosmeticDto, MyCosmeticsDto } from './dto/cosmetics-response.dto';
import { UserCosmeticsView, UserDisplaySummary } from './user-display-summary';
import { BANNER_MAX_FILE_SIZE } from './cosmetics.config';
import { EquipCosmeticsDto } from './dto/equip-cosmetics.dto';
import { Cosmetic, CosmeticType } from './entities/cosmetic.entity';
import { UserCosmetics } from './entities/user-cosmetics.entity';

interface CatalogIndex {
  byId: Map<number, Cosmetic>;
  defaults: Record<CosmeticType, CosmeticLike>;
}

// El catálogo casi nunca cambia: se guarda en memoria este tiempo para no
// consultarlo en cada listado. COSMETICS_CATALOG_CACHE_TTL_MS=0 lo desactiva
// (los e2e lo hacen para ver al instante los cambios hechos en la base).
const DEFAULT_CATALOG_CACHE_TTL_MS = 60_000;

@Injectable()
export class CosmeticsService {
  constructor(
    @InjectRepository(Cosmetic)
    private readonly cosmeticRepository: Repository<Cosmetic>,
    @InjectRepository(UserCosmetics)
    private readonly userCosmeticsRepository: Repository<UserCosmetics>,
    private readonly proStatusService: ProStatusService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  private catalogCache: { index: CatalogIndex; expiresAt: number } | null =
    null;

  // ---------------------------------------------------------------------
  // Catálogo
  // ---------------------------------------------------------------------

  async getCatalog(): Promise<CosmeticDto[]> {
    const cosmetics = await this.cosmeticRepository.find({
      where: { isActive: true },
      order: { type: 'ASC', sortOrder: 'ASC', id: 'ASC' },
    });
    return cosmetics.map((cosmetic) => this.toCatalogDto(cosmetic));
  }

  // ---------------------------------------------------------------------
  // Lo mío
  // ---------------------------------------------------------------------

  async getMine(userId: string): Promise<MyCosmeticsDto> {
    const [isPro, row, catalog] = await Promise.all([
      this.proStatusService.isPro(userId),
      this.userCosmeticsRepository.findOneBy({ userId }),
      this.loadCatalog(),
    ]);
    return {
      isPro,
      equipped: this.toEquipped(row, catalog),
      cosmetics: this.effective(row, catalog, isPro),
    };
  }

  // Solo cambia lo que se envía. Valida todo antes de guardar nada.
  async equip(userId: string, dto: EquipCosmeticsDto): Promise<MyCosmeticsDto> {
    if (
      dto.bannerId === undefined &&
      dto.gooseSkinId === undefined &&
      dto.frameId === undefined &&
      dto.useCustomBanner === undefined
    ) {
      throw new BadRequestException(
        'Indica al menos un cosmético para equipar',
      );
    }

    // El catálogo fresco: validar contra uno en caché podría aceptar un
    // cosmético recién desactivado.
    const [isPro, catalog] = await Promise.all([
      this.proStatusService.isPro(userId),
      this.loadCatalog(true),
    ]);
    const row = await this.getOrCreateRow(userId);

    const choose = (
      id: number | null | undefined,
      type: CosmeticType,
    ): number | null | undefined => {
      if (id === undefined || id === null) return id;
      const cosmetic = catalog.byId.get(id);
      if (!cosmetic || !cosmetic.isActive) {
        throw new NotFoundException('Cosmético no encontrado');
      }
      if (cosmetic.type !== type) {
        throw new BadRequestException(
          `El cosmético ${cosmetic.code} es de tipo ${cosmetic.type}, no ${type}`,
        );
      }
      if (cosmetic.proOnly && !isPro) {
        throw new ForbiddenException(
          'Este cosmético es exclusivo de Mynted Pro',
        );
      }
      return id;
    };
    const bannerId = choose(dto.bannerId, CosmeticType.BANNER);
    const gooseSkinId = choose(dto.gooseSkinId, CosmeticType.GOOSE_SKIN);
    const frameId = choose(dto.frameId, CosmeticType.FRAME);

    if (dto.useCustomBanner === true) {
      if (!isPro) {
        throw new ForbiddenException(
          'El banner propio es exclusivo de Mynted Pro',
        );
      }
      if (!row.customBannerUrl) {
        throw new BadRequestException(
          'Primero sube tu banner propio (PUT /users/me/banner)',
        );
      }
    }

    if (bannerId !== undefined) row.bannerCosmeticId = bannerId;
    if (gooseSkinId !== undefined) row.gooseSkinCosmeticId = gooseSkinId;
    if (frameId !== undefined) row.frameCosmeticId = frameId;
    if (dto.useCustomBanner !== undefined) {
      row.useCustomBanner = dto.useCustomBanner;
    } else if (dto.bannerId !== undefined) {
      // Elegir un banner (o volver al por defecto) deja el propio de lado.
      row.useCustomBanner = false;
    }
    await this.userCosmeticsRepository.save(row);

    return this.getMine(userId);
  }

  // ---------------------------------------------------------------------
  // Banner propio (solo Pro)
  // ---------------------------------------------------------------------

  // Sube el banner (JPEG, PNG, WEBP o GIF, hasta 8 MB), lo deja preferido y
  // borra de Cloudinary el anterior. Pro se comprueba antes de subir nada.
  async setCustomBanner(
    userId: string,
    file: Express.Multer.File | undefined,
  ): Promise<MyCosmeticsDto> {
    if (!(await this.proStatusService.isPro(userId))) {
      throw new ForbiddenException(
        'El banner propio es exclusivo de Mynted Pro',
      );
    }
    if (!file) {
      throw new BadRequestException(
        'Debe proporcionar un banner (campo banner)',
      );
    }

    const uploaded = await this.cloudinaryService.uploadImage(file, {
      maxFileSize: BANNER_MAX_FILE_SIZE,
    });
    const row = await this.getOrCreateRow(userId);
    const previousPublicId = row.customBannerPublicId;
    row.customBannerUrl = uploaded.url;
    row.customBannerPublicId = uploaded.publicId;
    row.customBannerIsAnimated = uploaded.isAnimated;
    row.useCustomBanner = true;
    try {
      await this.userCosmeticsRepository.save(row);
    } catch (error: unknown) {
      // No quedó referenciado: se borra para no dejar el archivo huérfano.
      await this.cloudinaryService.deleteImage(uploaded.publicId);
      throw error;
    }
    if (previousPublicId && previousPublicId !== uploaded.publicId) {
      await this.cloudinaryService.deleteImage(previousPublicId);
    }
    return this.getMine(userId);
  }

  // Quita el banner propio (no exige Pro: se puede quitar aunque haya
  // vencido) y lo borra de Cloudinary. Es idempotente.
  async removeCustomBanner(userId: string): Promise<void> {
    const row = await this.userCosmeticsRepository.findOneBy({ userId });
    if (!row?.customBannerUrl) return;

    const publicId = row.customBannerPublicId;
    row.customBannerUrl = null;
    row.customBannerPublicId = null;
    row.customBannerIsAnimated = false;
    row.useCustomBanner = false;
    await this.userCosmeticsRepository.save(row);
    if (publicId) await this.cloudinaryService.deleteImage(publicId);
  }

  // ---------------------------------------------------------------------
  // Lo de otros (listados, perfil público, tienda): por lotes
  // ---------------------------------------------------------------------

  /**
   * Resumen liviano (isPro + marco efectivo) de varios usuarios: el cargador
   * único de los listados (chat, reseñas, foro, búsquedas...). Una sola
   * resolución por lista, con como máximo 3 consultas: usuarios Pro, sus
   * preferencias (solo la columna del marco) y el catálogo (en caché unos 60 s).
   * Ignora ids repetidos y vacíos; quien no existe o no tiene preferencias
   * recibe isPro=false y el marco por defecto, sin fallar.
   */
  async getEffectiveSummaryForUsers(
    userIds: string[],
  ): Promise<Map<string, UserDisplaySummary>> {
    const result = new Map<string, UserDisplaySummary>();
    const ids = this.uniqueIds(userIds);
    if (ids.length === 0) return result;

    const [pro, rows, catalog] = await Promise.all([
      this.proStatusService.proUserIds(ids),
      this.userCosmeticsRepository.find({
        select: { userId: true, frameCosmeticId: true },
        where: { userId: In(ids) },
      }),
      this.loadCatalog(),
    ]);
    const frameByUser = new Map(
      rows.map((row) => [row.userId, row.frameCosmeticId]),
    );
    for (const id of ids) {
      const isPro = pro.has(id);
      const equipped = frameByUser.get(id);
      const frame = resolveEffective(
        equipped == null ? null : (catalog.byId.get(equipped) ?? null),
        catalog.defaults[CosmeticType.FRAME],
        isPro,
      );
      result.set(id, {
        isPro,
        frame: { code: frame.code, assetUrl: frame.assetUrl },
      });
    }
    return result;
  }

  // Lo mismo con los cosméticos completos (banner, ganso y marco) para el
  // perfil y la tienda. También 3 consultas como máximo por lista.
  async getEffectiveCosmeticsForUsers(
    userIds: string[],
  ): Promise<Map<string, UserCosmeticsView>> {
    const result = new Map<string, UserCosmeticsView>();
    const ids = this.uniqueIds(userIds);
    if (ids.length === 0) return result;

    const [pro, rows, catalog] = await Promise.all([
      this.proStatusService.proUserIds(ids),
      this.userCosmeticsRepository.find({ where: { userId: In(ids) } }),
      this.loadCatalog(),
    ]);
    const rowByUser = new Map(rows.map((row) => [row.userId, row]));
    for (const id of ids) {
      const isPro = pro.has(id);
      result.set(id, {
        isPro,
        cosmetics: this.effective(rowByUser.get(id) ?? null, catalog, isPro),
      });
    }
    return result;
  }

  // Descarta el catálogo en memoria (lo siguiente lo vuelve a consultar).
  clearCatalogCache(): void {
    this.catalogCache = null;
  }

  // ---------------------------------------------------------------------
  // Internos (el módulo de banner propio los reutiliza)
  // ---------------------------------------------------------------------

  async getOrCreateRow(userId: string): Promise<UserCosmetics> {
    await this.userCosmeticsRepository
      .createQueryBuilder()
      .insert()
      .into(UserCosmetics)
      .values({ userId })
      .orIgnore()
      .execute();
    return this.userCosmeticsRepository.findOneByOrFail({ userId });
  }

  private uniqueIds(userIds: string[]): string[] {
    return [...new Set(userIds.filter((id) => Boolean(id)))];
  }

  private catalogTtlMs(): number {
    const raw = process.env.COSMETICS_CATALOG_CACHE_TTL_MS;
    const parsed = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(parsed) && parsed >= 0
      ? parsed
      : DEFAULT_CATALOG_CACHE_TTL_MS;
  }

  // fresh=true ignora la caché (validaciones al equipar).
  private async loadCatalog(fresh = false): Promise<CatalogIndex> {
    const ttl = this.catalogTtlMs();
    const now = Date.now();
    if (
      !fresh &&
      ttl > 0 &&
      this.catalogCache &&
      this.catalogCache.expiresAt > now
    ) {
      return this.catalogCache.index;
    }
    const index = await this.buildCatalog();
    this.catalogCache = ttl > 0 ? { index, expiresAt: now + ttl } : null;
    return index;
  }

  private async buildCatalog(): Promise<CatalogIndex> {
    const cosmetics = await this.cosmeticRepository.find();
    const byId = new Map(cosmetics.map((cosmetic) => [cosmetic.id, cosmetic]));
    const defaultOf = (type: CosmeticType): CosmeticLike =>
      cosmetics.find(
        (cosmetic) => cosmetic.type === type && cosmetic.isDefault,
      ) ??
        // Catálogo sin sembrar: un valor neutro en vez de romper el perfil.
        {
          id: 0,
          code: `${type}_default`,
          type,
          assetUrl: null,
          proOnly: false,
          isActive: true,
        };
    return {
      byId,
      defaults: {
        [CosmeticType.BANNER]: defaultOf(CosmeticType.BANNER),
        [CosmeticType.GOOSE_SKIN]: defaultOf(CosmeticType.GOOSE_SKIN),
        [CosmeticType.FRAME]: defaultOf(CosmeticType.FRAME),
      },
    };
  }

  private effective(
    row: UserCosmetics | null,
    catalog: CatalogIndex,
    isPro: boolean,
  ): EffectiveCosmetics {
    const pick = (id: number | null | undefined) =>
      id == null ? null : (catalog.byId.get(id) ?? null);
    return resolveCosmetics({
      banner: {
        equipped: pick(row?.bannerCosmeticId),
        defaultRow: catalog.defaults[CosmeticType.BANNER],
        isPro,
        useCustomBanner: row?.useCustomBanner ?? false,
        customBanner: row?.customBannerUrl
          ? {
              url: row.customBannerUrl,
              isAnimated: row.customBannerIsAnimated,
            }
          : null,
      },
      gooseSkin: pick(row?.gooseSkinCosmeticId),
      gooseDefault: catalog.defaults[CosmeticType.GOOSE_SKIN],
      frame: pick(row?.frameCosmeticId),
      frameDefault: catalog.defaults[CosmeticType.FRAME],
    });
  }

  private toEquipped(row: UserCosmetics | null, catalog: CatalogIndex) {
    const ref = (id: number | null | undefined) => {
      const cosmetic = id == null ? undefined : catalog.byId.get(id);
      return cosmetic ? { id: cosmetic.id, code: cosmetic.code } : null;
    };
    return {
      banner: ref(row?.bannerCosmeticId),
      gooseSkin: ref(row?.gooseSkinCosmeticId),
      frame: ref(row?.frameCosmeticId),
      useCustomBanner: row?.useCustomBanner ?? false,
      customBanner: row?.customBannerUrl
        ? {
            url: row.customBannerUrl,
            staticUrl: toStaticImageUrl(
              row.customBannerUrl,
              row.customBannerIsAnimated,
            ),
            isAnimated: row.customBannerIsAnimated,
          }
        : null,
    };
  }

  private toCatalogDto(cosmetic: Cosmetic): CosmeticDto {
    return {
      id: cosmetic.id,
      code: cosmetic.code,
      type: cosmetic.type,
      name: cosmetic.name,
      assetUrl: cosmetic.assetUrl,
      proOnly: cosmetic.proOnly,
      isDefault: cosmetic.isDefault,
      sortOrder: cosmetic.sortOrder,
    };
  }
}
