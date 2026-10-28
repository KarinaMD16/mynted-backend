import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

export enum CosmeticType {
  BANNER = 'banner',
  GOOSE_SKIN = 'goose_skin',
  FRAME = 'frame',
}

// Catálogo de cosméticos de perfil. El `code` es el contrato estable con el
// frontend (ahí viven los recursos gráficos cuando asset_url es null): no se
// renombra una vez sembrado. Para agregar uno basta una entrada en
// BASE_COSMETICS (cosmetics.config.ts); se siembra al arrancar.
@Entity('cosmetic')
@Unique('UQ_cosmetic_code', ['code'])
// Un solo valor por defecto por tipo: nadie puede "cambiarlo" por otro.
@Index('UQ_cosmetic_default_per_type', ['type'], {
  unique: true,
  where: '"is_default" = true',
})
@Index('IDX_cosmetic_type_sort_order', ['type', 'sortOrder'])
export class Cosmetic {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  code!: string;

  @Column({ type: 'enum', enum: CosmeticType })
  type!: CosmeticType;

  // Texto de respaldo en español; el front traduce por code.
  @Column()
  name!: string;

  // Null cuando el recurso vive en el frontend y se mapea por code.
  @Column({ name: 'asset_url', type: 'text', nullable: true })
  assetUrl!: string | null;

  // Solo lo puede equipar (y ver aplicado) quien tiene Pro vigente.
  @Column({ name: 'pro_only', type: 'boolean', default: false })
  proOnly!: boolean;

  // Lo que se muestra cuando no hay nada equipado o lo equipado no aplica.
  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  // Desactivarlo (a mano en la base) lo saca del catálogo y de lo efectivo; el
  // seed no lo pisa.
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;
}
