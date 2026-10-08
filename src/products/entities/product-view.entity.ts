import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Product } from './product.entity';

// Una fila por usuario y producto: viewedAt se actualiza en cada nueva vista,
// así los "últimos productos vistos" salen ordenando por viewedAt.
@Entity('product_view')
@Unique('UQ_product_view_user_id_product_id', ['userId', 'productId'])
export class ProductView {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user!: User;

  @Column({ name: 'product_id' })
  productId!: number;

  @ManyToOne(() => Product, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id', referencedColumnName: 'id' })
  product!: Product;

  @Column({
    name: 'viewed_at',
    type: 'timestamp with time zone',
    default: () => 'now()',
  })
  viewedAt!: Date;
}
