import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Community } from './community.entity';
import { Tag } from './tag.entity';

@Entity('community_tag')
@Unique('UQ_community_tag_community_id_tag_id', ['communityId', 'tagId'])
export class CommunityTag {
  @PrimaryGeneratedColumn({ name: 'community_tag_id' })
  communityTagId!: number;

  @Column({ name: 'community_id' })
  communityId!: number;

  @Column({ name: 'tag_id' })
  tagId!: number;

  @ManyToOne(() => Community, (community) => community.communityTags, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'community_id', referencedColumnName: 'id' })
  community!: Community;

  @ManyToOne(() => Tag, (tag) => tag.communityTags, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'tag_id', referencedColumnName: 'tagId' })
  tag!: Tag;
}
