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
import { User } from '../../users/entities/user.entity';
import { PostImage } from './post-image.entity';
import { PostTag } from './post-tag.entity';
import { PostVote } from './post-vote.entity';
import { Reply } from './reply.entity';

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

  @Column({ name: 'community_profile_id' })
  communityProfileId!: number;

  @Column({ name: 'is_hidden', type: 'boolean', default: false })
  isHidden!: boolean;

  @Column({
    name: 'hidden_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  hiddenAt!: Date | null;

  @Column({ name: 'hidden_by_user_id', type: 'uuid', nullable: true })
  hiddenByUserId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'hidden_by_user_id', referencedColumnName: 'id' })
  hiddenByUser!: User | null;

  @Column({ name: 'hidden_reason', type: 'text', nullable: true })
  hiddenReason!: string | null;

  @ManyToOne(() => CommunityProfile, (profile) => profile.posts, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'community_profile_id',
    referencedColumnName: 'communityProfileId',
  })
  communityProfile!: CommunityProfile;

  @OneToMany(() => PostTag, (postTag) => postTag.post)
  postTags!: PostTag[];

  @OneToMany(() => PostImage, (image) => image.post)
  images!: PostImage[];

  @OneToMany(() => Reply, (reply) => reply.post)
  replies!: Reply[];

  @OneToMany(() => PostVote, (vote) => vote.post)
  votes!: PostVote[];
}
