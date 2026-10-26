import { ApiProperty } from '@nestjs/swagger';
import { CosmeticType } from '../entities/cosmetic.entity';

export class CosmeticDto {
  @ApiProperty({ example: 3 })
  id!: number;

  @ApiProperty({
    example: 'banner_aurora',
    description: 'Estable: el frontend mapea sus recursos por code',
  })
  code!: string;

  @ApiProperty({ enum: CosmeticType })
  type!: CosmeticType;

  @ApiProperty({ example: 'Aurora' })
  name!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'null si el recurso vive en el frontend (mapear por code)',
  })
  assetUrl!: string | null;

  @ApiProperty({ example: true, description: 'Solo se aplica con Pro vigente' })
  proOnly!: boolean;

  @ApiProperty({ example: false })
  isDefault!: boolean;

  @ApiProperty({ example: 20 })
  sortOrder!: number;
}

export class EffectiveBannerDto {
  @ApiProperty({
    enum: ['custom', 'catalog', 'default'],
    description:
      'custom: banner propio (Pro) · catalog: uno del catálogo · default: el por defecto',
  })
  source!: 'custom' | 'catalog' | 'default';

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'null con el banner propio',
  })
  code!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Imagen del banner (puede ser un GIF animado: úsala en el perfil). null si el recurso se mapea por code',
  })
  url!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Primer fotograma si es animado (igual a url si no): úsala en listados, chat y posts',
  })
  staticUrl!: string | null;

  @ApiProperty({ example: false })
  isAnimated!: boolean;
}

export class EffectiveAssetDto {
  @ApiProperty({ example: 'goose_ninja' })
  code!: string;

  @ApiProperty({ type: String, nullable: true })
  assetUrl!: string | null;
}

// Lo que se aplica de verdad: si el usuario no es Pro (o venció), son los
// valores por defecto aunque tenga otros equipados.
export class EffectiveCosmeticsDto {
  @ApiProperty({ type: EffectiveBannerDto })
  banner!: EffectiveBannerDto;

  @ApiProperty({ type: EffectiveAssetDto })
  gooseSkin!: EffectiveAssetDto;

  @ApiProperty({ type: EffectiveAssetDto })
  frame!: EffectiveAssetDto;
}

export class CosmeticRefDto {
  @ApiProperty({ example: 3 })
  id!: number;

  @ApiProperty({ example: 'banner_aurora' })
  code!: string;
}

export class CustomBannerDto {
  @ApiProperty()
  url!: string;

  @ApiProperty({ description: 'Primer fotograma si es animado' })
  staticUrl!: string;

  @ApiProperty({ example: true })
  isAnimated!: boolean;
}

// Lo que el usuario tiene guardado (preferencia): se conserva al vencer Pro.
export class EquippedCosmeticsDto {
  @ApiProperty({ type: CosmeticRefDto, nullable: true })
  banner!: CosmeticRefDto | null;

  @ApiProperty({ type: CosmeticRefDto, nullable: true })
  gooseSkin!: CosmeticRefDto | null;

  @ApiProperty({ type: CosmeticRefDto, nullable: true })
  frame!: CosmeticRefDto | null;

  @ApiProperty({ example: false })
  useCustomBanner!: boolean;

  @ApiProperty({ type: CustomBannerDto, nullable: true })
  customBanner!: CustomBannerDto | null;
}

export class MyCosmeticsDto {
  @ApiProperty({ example: true })
  isPro!: boolean;

  @ApiProperty({ type: EquippedCosmeticsDto })
  equipped!: EquippedCosmeticsDto;

  @ApiProperty({ type: EffectiveCosmeticsDto })
  cosmetics!: EffectiveCosmeticsDto;
}
