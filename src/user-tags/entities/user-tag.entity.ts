import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Tag } from '../../community/entities/tag.entity';

@Entity('user_tag')
@Unique('UQ_user_tag_user_id_tag_id', ['userId', 'tagId'])
export class UserTag {
  @PrimaryGeneratedColumn({ name: 'user_tag_id' })
  userTagId!: number;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'tag_id' })
  tagId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user!: User;

  @ManyToOne(() => Tag, (tag) => tag.userTags, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'tag_id', referencedColumnName: 'tagId' })
  tag!: Tag;
}
