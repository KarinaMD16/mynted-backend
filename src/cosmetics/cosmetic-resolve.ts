import { toStaticImageUrl } from './banner-urls';
import { CosmeticType } from './entities/cosmetic.entity';

// Funciones puras: qué cosmético se aplica de verdad según lo equipado y si el
// usuario es Pro. No tocan la base: por eso al vencer Pro no hay nada que
// borrar y al renovar todo vuelve solo.

export interface CosmeticLike {
  id: number;
  code: string;
  type: CosmeticType;
  assetUrl: string | null;
  proOnly: boolean;
  isActive: boolean;
}

export interface EffectiveBanner {
  // custom: banner propio · catalog: uno del catálogo · default: el por defecto.
  source: 'custom' | 'catalog' | 'default';
  // null con el banner propio (no es del catálogo).
  code: string | null;
  url: string | null;
  // Primer fotograma si es animado; igual a url si no. Para listados, chat y
  // posts; la URL animada solo para el perfil.
  staticUrl: string | null;
  isAnimated: boolean;
}

export interface EffectiveAsset {
  code: string;
  assetUrl: string | null;
}

export interface EffectiveCosmetics {
  banner: EffectiveBanner;
  gooseSkin: EffectiveAsset;
  frame: EffectiveAsset;
}

export interface CustomBanner {
  url: string;
  isAnimated: boolean;
}

// Lo equipado si está activo y (no es Pro-only o el usuario es Pro); si no, el
// valor por defecto del tipo.
export function resolveEffective<
  T extends Pick<CosmeticLike, 'proOnly' | 'isActive'>,
>(equipped: T | null | undefined, defaultRow: T, isPro: boolean): T {
  if (equipped && equipped.isActive && (!equipped.proOnly || isPro)) {
    return equipped;
  }
  return defaultRow;
}

export interface BannerInput {
  equipped: CosmeticLike | null;
  defaultRow: CosmeticLike;
  isPro: boolean;
  useCustomBanner: boolean;
  customBanner: CustomBanner | null;
}

// El banner propio solo cuenta si es Pro, lo prefirió (use_custom_banner) y
// existe la URL.
export function resolveBanner(input: BannerInput): EffectiveBanner {
  const { isPro, useCustomBanner, customBanner } = input;
  if (isPro && useCustomBanner && customBanner?.url) {
    return {
      source: 'custom',
      code: null,
      url: customBanner.url,
      staticUrl: toStaticImageUrl(customBanner.url, customBanner.isAnimated),
      isAnimated: customBanner.isAnimated,
    };
  }
  const row = resolveEffective(input.equipped, input.defaultRow, isPro);
  return {
    source: row.id === input.defaultRow.id ? 'default' : 'catalog',
    code: row.code,
    url: row.assetUrl,
    staticUrl: row.assetUrl,
    isAnimated: false,
  };
}

export interface CosmeticsInput {
  banner: BannerInput;
  gooseSkin: CosmeticLike | null;
  gooseDefault: CosmeticLike;
  frame: CosmeticLike | null;
  frameDefault: CosmeticLike;
}

export function resolveCosmetics(input: CosmeticsInput): EffectiveCosmetics {
  const isPro = input.banner.isPro;
  const asset = (row: CosmeticLike): EffectiveAsset => ({
    code: row.code,
    assetUrl: row.assetUrl,
  });
  return {
    banner: resolveBanner(input.banner),
    gooseSkin: asset(
      resolveEffective(input.gooseSkin, input.gooseDefault, isPro),
    ),
    frame: asset(resolveEffective(input.frame, input.frameDefault, isPro)),
  };
}
