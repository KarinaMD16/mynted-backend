import { CosmeticType } from './entities/cosmetic.entity';

// Tope del banner propio (la foto de perfil se queda en 5 MB). Un GIF animado
// suele pasar de 5 MB.
export const BANNER_MAX_FILE_SIZE = 8 * 1024 * 1024;

export interface CosmeticDefinition {
  code: string;
  type: CosmeticType;
  name: string;
  assetUrl: string | null;
  proOnly: boolean;
  isDefault: boolean;
  sortOrder: number;
}

const cosmetic = (
  type: CosmeticType,
  code: string,
  name: string,
  options: Partial<
    Pick<CosmeticDefinition, 'assetUrl' | 'proOnly' | 'isDefault' | 'sortOrder'>
  > = {},
): CosmeticDefinition => ({
  type,
  code,
  name,
  assetUrl: options.assetUrl ?? null,
  proOnly: options.proOnly ?? false,
  isDefault: options.isDefault ?? false,
  sortOrder: options.sortOrder ?? 0,
});

/**
 * Catálogo base de cosméticos. Se siembra al arrancar (CosmeticsSeed, upsert
 * por `code`): crea los que faltan y actualiza nombre, tipo, asset_url,
 * pro_only, is_default y orden de los existentes, pero NO pisa `is_active`.
 *
 * Para agregar uno: una línea aquí con un `code` nuevo y estable (el frontend
 * mapea sus recursos por code; asset_url puede quedar null). Debe haber
 * exactamente UN default por tipo (pro_only=false) y no se cambia por otro.
 * Para retirar uno, desactívalo en la base (is_active=false): deja de aparecer
 * y quien lo tenía equipado vuelve al default del tipo.
 */
export const BASE_COSMETICS: CosmeticDefinition[] = [
  // ---- banners de perfil
  cosmetic(CosmeticType.BANNER, 'banner_default', 'Banner por defecto', {
    isDefault: true,
  }),
  cosmetic(CosmeticType.BANNER, 'banner_sunset', 'Atardecer', {
    sortOrder: 10,
  }),
  cosmetic(CosmeticType.BANNER, 'banner_aurora', 'Aurora', {
    proOnly: true,
    sortOrder: 20,
  }),
  cosmetic(CosmeticType.BANNER, 'banner_gold', 'Dorado', {
    proOnly: true,
    sortOrder: 30,
  }),
  // ---- skins del ganso
  cosmetic(CosmeticType.GOOSE_SKIN, 'goose_default', 'Ganso clásico', {
    isDefault: true,
  }),
  cosmetic(CosmeticType.GOOSE_SKIN, 'goose_blue', 'Ganso azul', {
    sortOrder: 10,
  }),
  cosmetic(CosmeticType.GOOSE_SKIN, 'goose_ninja', 'Ganso ninja', {
    proOnly: true,
    sortOrder: 20,
  }),
  cosmetic(CosmeticType.GOOSE_SKIN, 'goose_astronaut', 'Ganso astronauta', {
    proOnly: true,
    sortOrder: 30,
  }),
  // ---- marcos de avatar
  cosmetic(CosmeticType.FRAME, 'frame_default', 'Sin marco', {
    isDefault: true,
  }),
  cosmetic(CosmeticType.FRAME, 'frame_simple', 'Marco simple', {
    sortOrder: 10,
  }),
  cosmetic(CosmeticType.FRAME, 'frame_gold', 'Marco dorado', {
    proOnly: true,
    sortOrder: 20,
  }),
  cosmetic(CosmeticType.FRAME, 'frame_neon', 'Marco neón', {
    proOnly: true,
    sortOrder: 30,
  }),
];
