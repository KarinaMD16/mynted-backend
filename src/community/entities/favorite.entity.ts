import {
  Column,
  CreateDateColumn,
  Entity,
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
}
