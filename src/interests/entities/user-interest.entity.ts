import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Interest } from './interest.entity';

@Entity('user_interests')
@Unique(['userId', 'interestId'])
export class UserInterest {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'interest_id' })
  interestId!: number;

  @ManyToOne(() => Interest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'interest_id' })
  interest!: Interest;

  @Column({ name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
