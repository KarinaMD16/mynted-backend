import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum FavoriteItemType {
  POST = 'POST',
  PRODUCT = 'PRODUCT',
  REPLY = 'REPLY',
}

@Entity('favorite')
// Quién guardó un item (avisos a los que guardaron un producto).
@Index('IDX_favorite_item_type_item_id', ['itemType', 'itemId'])
@Unique('UQ_favorite_user_id_item_id_item_type', [
  'userId',
  'itemId',
  'itemType',
])
export class Favorite {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user!: User;

  @Column({ name: 'item_id' })
  itemId!: number;

  @Column({ type: 'enum', enum: FavoriteItemType })
  itemType!: FavoriteItemType;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  // Avisos del producto guardado (tarea 1044). Solo aplican a PRODUCT.
  @Column({ name: 'notify_price', type: 'boolean', default: false })
  notifyPrice!: boolean;

  @Column({ name: 'notify_availability', type: 'boolean', default: false })
  notifyAvailability!: boolean;
}
