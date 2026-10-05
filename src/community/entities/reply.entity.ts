import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CommunityProfile } from './community-profile.entity';
import { Post } from './post.entity';

@Entity('reply')
export class Reply {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  body!: string;

  @CreateDateColumn({ name: 'posted_at', type: 'timestamp with time zone' })
  postedAt!: Date;

  @Column({ name: 'post_id' })
  postId!: number;

  @ManyToOne(() => Post, (post) => post.replies, {
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

  @Column({ name: 'parent_reply_id', nullable: true })
  parentReplyId!: number | null;

  @ManyToOne(() => Reply, (reply) => reply.children, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'parent_reply_id', referencedColumnName: 'id' })
  parentReply!: Reply | null;

  @OneToMany(() => Reply, (reply) => reply.parentReply)
  children!: Reply[];
}
