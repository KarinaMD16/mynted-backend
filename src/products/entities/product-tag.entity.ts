import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Tag } from '../../community/entities/tag.entity';
import { Product } from './product.entity';

@Entity('product_tag')
@Unique('UQ_product_tag_product_id_tag_id', ['productId', 'tagId'])
export class ProductTag {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'product_id' })
  productId!: number;

  @ManyToOne(() => Product, (product) => product.productTags, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'product_id', referencedColumnName: 'id' })
  product!: Product;

  @Column({ name: 'tag_id' })
  tagId!: number;

  @ManyToOne(() => Tag, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tag_id', referencedColumnName: 'tagId' })
  tag!: Tag;
}
