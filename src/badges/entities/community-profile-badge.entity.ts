import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { CommunityProfile } from '../../community/entities/community-profile.entity';
import { Badge } from './badge.entity';

@Entity('community_profile_badge')
@Unique('UQ_community_profile_badge_profile_id_badge_id', [
  'communityProfileId',
  'badgeId',
])
export class CommunityProfileBadge {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'community_profile_id' })
  communityProfileId!: number;

  @ManyToOne(() => CommunityProfile, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'community_profile_id',
    referencedColumnName: 'communityProfileId',
  })
  communityProfile!: CommunityProfile;

  @Column({ name: 'badge_id' })
  badgeId!: number;

  @ManyToOne(() => Badge, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'badge_id', referencedColumnName: 'id' })
  badge!: Badge;

  @CreateDateColumn({ name: 'awarded_at', type: 'timestamp with time zone' })
  awardedAt!: Date;
}
