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
import { User } from '../../users/entities/user.entity';
import { Community } from './community.entity';
import { Post } from './post.entity';

export enum CommunityProfileRole {
  MEMBER = 'member',
  MODERATOR = 'moderator',
  OWNER = 'owner',
}

@Entity('community_profile')
@Unique('UQ_community_profile_user_id_community_id', ['userId', 'communityId'])
export class CommunityProfile {
  @PrimaryGeneratedColumn({ name: 'community_profile_id' })
  communityProfileId!: number;

  @Column({ name: 'display_name' })
  displayName!: string;

  @Column()
  bio!: string;

  @CreateDateColumn({ name: 'joined_at', type: 'timestamp with time zone' })
  joinedAt!: Date;

  @Column({
    type: 'enum',
    enum: CommunityProfileRole,
    default: CommunityProfileRole.MEMBER,
  })
  role!: CommunityProfileRole;

  @Column({ name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user!: User;

  @Column({ name: 'community_id' })
  communityId!: number;

  @ManyToOne(() => Community, (community) => community.communityProfiles, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'community_id', referencedColumnName: 'id' })
  community!: Community;

  @OneToMany(() => Post, (post) => post.communityProfile)
  posts!: Post[];
}
