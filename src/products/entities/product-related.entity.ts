import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Product } from './product.entity';

// Productos relacionados elegidos a mano por el vendedor (máximo 6 por
// producto, del mismo vendedor y activos).
@Entity('product_related')
@Unique('UQ_product_related_product_id_related_product_id', [
  'productId',
  'relatedProductId',
])
export class ProductRelated {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'product_id' })
  productId!: number;

  @ManyToOne(() => Product, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id', referencedColumnName: 'id' })
  product!: Product;

  @Column({ name: 'related_product_id' })
  relatedProductId!: number;

  @ManyToOne(() => Product, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'related_product_id', referencedColumnName: 'id' })
  relatedProduct!: Product;
}
