import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CommunityProfile } from './community-profile.entity';

@Entity('post')
export class Post {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @CreateDateColumn({ name: 'posted_at', type: 'timestamp with time zone' })
  postedAt!: Date;

  @Column({ name: 'up_votes', default: 0 })
  upVotes!: number;

  @Column({ name: 'down_votes', default: 0 })
  downVotes!: number;

  @Column({ name: 'times_saved', default: 0 })
  timesSaved!: number;

  @Column({ name: 'community_profile_id' })
  communityProfileId!: number;

  @ManyToOne(() => CommunityProfile, (profile) => profile.posts, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'community_profile_id',
    referencedColumnName: 'communityProfileId',
  })
  communityProfile!: CommunityProfile;
}
