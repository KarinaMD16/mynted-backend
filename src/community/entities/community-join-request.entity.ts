import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Community } from './community.entity';
import { CommunityProfile } from './community-profile.entity';

export enum CommunityJoinRequestStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

@Entity('community_join_request')
export class CommunityJoinRequest {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user!: User;

  @Column({ name: 'community_id' })
  communityId!: number;

  @ManyToOne(() => Community, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'community_id', referencedColumnName: 'id' })
  community!: Community;

  @Column({
    type: 'enum',
    enum: CommunityJoinRequestStatus,
    default: CommunityJoinRequestStatus.PENDING,
  })
  status!: CommunityJoinRequestStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @Column({
    name: 'resolved_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  resolvedAt!: Date | null;

  @Column({ name: 'resolved_by_profile_id', nullable: true })
  resolvedByProfileId!: number | null;

  @ManyToOne(() => CommunityProfile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'resolved_by_profile_id',
    referencedColumnName: 'communityProfileId',
  })
  resolvedByProfile!: CommunityProfile | null;
}
