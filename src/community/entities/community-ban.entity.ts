import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Community } from './community.entity';

@Entity('community_ban')
@Unique('UQ_community_ban_community_id_user_id', ['communityId', 'userId'])
export class CommunityBan {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'community_id' })
  communityId!: number;

  @ManyToOne(() => Community, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'community_id', referencedColumnName: 'id' })
  community!: Community;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user!: User;

  @Column({ name: 'banned_by_user_id', type: 'uuid' })
  bannedByUserId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'banned_by_user_id', referencedColumnName: 'id' })
  bannedBy!: User;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}
