import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Post } from './post.entity';
import { Tag } from './tag.entity';

@Entity('post_tag')
@Unique('UQ_post_tag_post_id_tag_id', ['postId', 'tagId'])
export class PostTag {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'post_id' })
  postId!: number;

  @ManyToOne(() => Post, (post) => post.postTags, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'post_id', referencedColumnName: 'id' })
  post!: Post;

  @Column({ name: 'tag_id' })
  tagId!: number;

  @ManyToOne(() => Tag, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tag_id', referencedColumnName: 'tagId' })
  tag!: Tag;
}
