import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Community } from './community.entity';

@Entity('community_rule')
@Unique('UQ_community_rule_community_id_description', [
  'communityId',
  'description',
])
export class CommunityRule {
  @PrimaryGeneratedColumn({ name: 'community_rule_id' })
  communityRuleId!: number;

  @Column({ name: 'community_id' })
  communityId!: number;

  @Column()
  description!: string;

  @ManyToOne(() => Community, (community) => community.rules, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'community_id', referencedColumnName: 'id' })
  community!: Community;
}
