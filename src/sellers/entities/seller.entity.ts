import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { PaymentInfo } from './payment-info.entity';

@Entity('seller')
export class Seller {
  @PrimaryGeneratedColumn({ name: 'seller_id' })
  sellerId!: number;

  @Column({ name: 'display_name' })
  displayName!: string;

  @Column()
  description!: string;

  @Column()
  location!: string;

  @Column({ name: 'is_verified', default: false })
  isVerified!: boolean;

  @Column({ name: 'user_id', unique: true })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user!: User;

  @Column({ name: 'payment_id' })
  paymentId!: number;

  @ManyToOne(() => PaymentInfo, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'payment_id', referencedColumnName: 'paymentInfoId' })
  paymentInfo!: PaymentInfo;
}
