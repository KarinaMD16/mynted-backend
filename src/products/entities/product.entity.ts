import {
  Column,
  CreateDateColumn,
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
  ACTIVE = 'active',
  SOLD = 'sold',
  INACTIVE = 'inactive',
}

@Entity('product')
export class Product {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  title!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  price!: number;

  @Column()
  currency!: string;

  @Column({ name: 'image_url', type: 'text' })
  imageUrl!: string;

  @Column({
    type: 'enum',
    enum: ProductStatus,
    default: ProductStatus.ACTIVE,
  })
  status!: ProductStatus;

  @Column({ name: 'seller_id' })
  sellerId!: number;

  @ManyToOne(() => Seller, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'seller_id', referencedColumnName: 'sellerId' })
  seller!: Seller;

  @Column({ name: 'community_id' })
  communityId!: number;

  @ManyToOne(() => Community, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'community_id', referencedColumnName: 'id' })
  community!: Community;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;

  @OneToMany(() => ProductTag, (productTag) => productTag.product)
  productTags!: ProductTag[];

  @OneToMany(() => ProductImage, (productImage) => productImage.product)
  images!: ProductImage[];
}
