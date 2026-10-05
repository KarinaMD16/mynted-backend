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
import { Reply } from './reply.entity';
import { VoteType } from './vote-type.enum';

@Entity('reply_vote')
@Unique('UQ_reply_vote_reply_id_community_profile_id', [
  'replyId',
  'communityProfileId',
])
export class ReplyVote {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'reply_id' })
  replyId!: number;

  @ManyToOne(() => Reply, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reply_id', referencedColumnName: 'id' })
  reply!: Reply;

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
