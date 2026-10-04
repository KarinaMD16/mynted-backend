import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Post } from './post.entity';

@Entity('post_image')
@Unique('UQ_post_image_post_id_order', ['postId', 'order'])
export class PostImage {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  url!: string;

  @Column({ name: 'order' })
  order!: number;

  @Column({ name: 'post_id' })
  postId!: number;

  @ManyToOne(() => Post, (post) => post.images, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'post_id', referencedColumnName: 'id' })
  post!: Post;
}
