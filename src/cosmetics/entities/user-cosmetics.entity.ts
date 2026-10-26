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
import { Cosmetic } from './cosmetic.entity';

// Lo que el usuario tiene equipado y su banner propio. Es la preferencia, no
// lo efectivo: al vencer Pro no se borra nada, solo deja de aplicarse (ver
// resolveCosmetics). Una fila por usuario, creada al equipar por primera vez.
@Entity('user_cosmetics')
@Unique('UQ_user_cosmetics_user_id', ['userId'])
export class UserCosmetics {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user!: User;

  @Column({ name: 'banner_cosmetic_id', type: 'int', nullable: true })
  bannerCosmeticId!: number | null;

  @ManyToOne(() => Cosmetic, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'banner_cosmetic_id', referencedColumnName: 'id' })
  bannerCosmetic!: Cosmetic | null;

  @Column({ name: 'goose_skin_cosmetic_id', type: 'int', nullable: true })
  gooseSkinCosmeticId!: number | null;

  @ManyToOne(() => Cosmetic, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'goose_skin_cosmetic_id', referencedColumnName: 'id' })
  gooseSkinCosmetic!: Cosmetic | null;

  @Column({ name: 'frame_cosmetic_id', type: 'int', nullable: true })
  frameCosmeticId!: number | null;

  @ManyToOne(() => Cosmetic, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'frame_cosmetic_id', referencedColumnName: 'id' })
  frameCosmetic!: Cosmetic | null;

  // Prefiere el banner propio al del catálogo (solo se aplica con Pro).
  @Column({ name: 'use_custom_banner', type: 'boolean', default: false })
  useCustomBanner!: boolean;

  @Column({ name: 'custom_banner_url', type: 'text', nullable: true })
  customBannerUrl!: string | null;

  // Para borrar el archivo de Cloudinary al reemplazarlo o quitarlo.
  @Column({ name: 'custom_banner_public_id', type: 'varchar', nullable: true })
  customBannerPublicId!: string | null;

  @Column({
    name: 'custom_banner_is_animated',
    type: 'boolean',
    default: false,
  })
  customBannerIsAnimated!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}
