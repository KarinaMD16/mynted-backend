import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Seller } from '../../sellers/entities/seller.entity';
import { Community } from '../../community/entities/community.entity';
import { ProductTag } from './product-tag.entity';
import { ProductImage } from './product-image.entity';

export enum ProductStatus {
  // Borrador: solo lo ve su dueño; no aparece en ningún listado público.
  DRAFT = 'draft',
  ACTIVE = 'active',
  SOLD = 'sold',
  INACTIVE = 'inactive',
}

export enum ProductType {
  SALE = 'sale',
  EXCHANGE = 'exchange',
}

export enum ProductCondition {
  NEW = 'new',
  LIKE_NEW = 'like_new',
  GOOD_CONDITION = 'good_condition',
  USED_WITH_DETAILS = 'used_with_details',
}

@Entity('product')
export class Product {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  title!: string;

  // description, price, currency, imageUrl, type y condition son nullable
  // únicamente para los borradores; al publicar (status active) siempre
  // están completos, por eso el tipo TS no incluye null.
  @Column({ type: 'text', nullable: true })
  description!: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  price!: number;

  @Column({ type: 'varchar', nullable: true })
  currency!: string;

  // Porcentaje de descuento (0-100). No sobrescribe price: finalPrice se
  // calcula al responder.
  @Column({
    name: 'discount_percent',
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: {
      to: (value: number | null | undefined) => value ?? null,
      from: (value: string | null) =>
        value === null ? null : parseFloat(value),
    },
  })
  discountPercent!: number | null;

  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl!: string;

  @Column({
    type: 'enum',
    enum: ProductStatus,
    default: ProductStatus.ACTIVE,
  })
  status!: ProductStatus;

  @Column({ type: 'enum', enum: ProductType, nullable: true })
  type!: ProductType;

  @Column({ type: 'enum', enum: ProductCondition, nullable: true })
  condition!: ProductCondition;

  // Países a los que el vendedor envía (ISO 3166-1 alfa-2).
  @Column({
    name: 'ships_to',
    type: 'varchar',
    length: 2,
    array: true,
    default: () => "'{}'",
  })
  shipsTo!: string[];

  @Column({ name: 'seller_id' })
  sellerId!: number;

  @ManyToOne(() => Seller, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'seller_id', referencedColumnName: 'sellerId' })
  seller!: Seller;

  // La comunidad es opcional: un producto puede publicarse sin comunidad.
  @Column({ name: 'community_id', type: 'int', nullable: true })
  communityId!: number | null;

  @ManyToOne(() => Community, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'community_id', referencedColumnName: 'id' })
  community!: Community | null;

  // Los listados públicos filtran por isVisible = true y status = active.
  @Column({ name: 'is_visible', type: 'boolean', default: true })
  isVisible!: boolean;

  // Se fija al publicar un borrador por primera vez.
  @Column({
    name: 'published_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  publishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;

  // Borrado lógico: conserva favoritos y conversaciones; los listados lo ignoran.
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp with time zone' })
  deletedAt!: Date | null;

  @OneToMany(() => ProductTag, (productTag) => productTag.product)
  productTags!: ProductTag[];

  @OneToMany(() => ProductImage, (productImage) => productImage.product)
  images!: ProductImage[];
}
