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
