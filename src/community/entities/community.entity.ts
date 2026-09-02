import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Category } from './category.entity';
import { CommunityRule } from './community-rule.entity';
import { CommunityTag } from './community-tag.entity';

@Entity('community')
@Unique('UQ_community_name', ['name'])
@Unique('UQ_community_slug', ['slug'])
export class Community {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column()
  description!: string;

  @Column()
  slug!: string;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ name: 'is_private' })
  isPrivate!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @Column({ name: 'image_url' })
  imageUrl!: string;

  @Column({ name: 'banner_url' })
  bannerUrl!: string;

  @Column({ name: 'category_id' })
  categoryId!: number;

  @ManyToOne(() => Category, (category) => category.communities, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'category_id', referencedColumnName: 'categoryId' })
  category!: Category;

  @OneToMany(() => CommunityTag, (communityTag) => communityTag.community)
  communityTags!: CommunityTag[];

  @OneToMany(() => CommunityRule, (rule) => rule.community)
  rules!: CommunityRule[];
}
