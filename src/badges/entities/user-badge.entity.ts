import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Badge } from './badge.entity';

@Entity('user_badge')
@Unique('UQ_user_badge_user_id_badge_id', ['userId', 'badgeId'])
export class UserBadge {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user!: User;

  @Column({ name: 'badge_id' })
  badgeId!: number;

  @ManyToOne(() => Badge, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'badge_id', referencedColumnName: 'id' })
  badge!: Badge;

  @CreateDateColumn({ name: 'awarded_at', type: 'timestamp with time zone' })
  awardedAt!: Date;
}
