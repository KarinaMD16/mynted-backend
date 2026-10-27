import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('moderation_action')
@Index('IDX_moderation_action_created_at_id', ['createdAt', 'id'])
@Index('IDX_moderation_action_actor_user_id', ['actorUserId'])
@Index('IDX_moderation_action_target', ['targetType', 'targetId'])
export class ModerationAction {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'actor_user_id', type: 'uuid' })
  actorUserId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'actor_user_id', referencedColumnName: 'id' })
  actor!: User;

  @Column({ name: 'target_type', type: 'varchar' })
  targetType!: string;

  @Column({ name: 'target_id', type: 'varchar' })
  targetId!: string;

  @Column({ type: 'varchar' })
  action!: string;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ name: 'community_id', type: 'int', nullable: true })
  communityId!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;
}
