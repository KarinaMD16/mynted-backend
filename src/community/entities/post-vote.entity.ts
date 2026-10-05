import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { CommunityProfile } from './community-profile.entity';
import { Post } from './post.entity';
import { VoteType } from './vote-type.enum';

@Entity('post_vote')
@Unique('UQ_post_vote_post_id_community_profile_id', [
  'postId',
  'communityProfileId',
])
export class PostVote {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'post_id' })
  postId!: number;

  @ManyToOne(() => Post, (post) => post.votes, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'post_id', referencedColumnName: 'id' })
  post!: Post;

  @Column({ name: 'community_profile_id' })
  communityProfileId!: number;

  @ManyToOne(() => CommunityProfile, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'community_profile_id',
    referencedColumnName: 'communityProfileId',
  })
  communityProfile!: CommunityProfile;

  @Column({ type: 'enum', enum: VoteType })
  voteType!: VoteType;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;
}
