import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  email!: string;

  @Column({ unique: true })
  username!: string;

  @Exclude()
  @Column({ name: 'password_hash' })
  passwordHash!: string;

  @Column({ name: 'photo_url', nullable: true })
  photoUrl!: string;

  @Exclude()
  @Column({ name: 'reset_password_token_hash', nullable: true, type: 'text' })
  resetPasswordTokenHash!: string | null;

  @Exclude()
  @Column({
    name: 'reset_password_expires_at',
    nullable: true,
    type: 'timestamp with time zone',
  })
  resetPasswordExpiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}
