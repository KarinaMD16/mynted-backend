import {
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { CommunityTag } from './community-tag.entity';

@Entity('tag')
@Unique('UQ_tag_name', ['name'])
export class Tag {
  @PrimaryGeneratedColumn({ name: 'tag_id' })
  tagId!: number;

  @Column()
  name!: string;

  @OneToMany(() => CommunityTag, (communityTag) => communityTag.tag)
  communityTags!: CommunityTag[];
}
