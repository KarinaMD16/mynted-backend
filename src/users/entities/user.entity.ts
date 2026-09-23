import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';

export enum UserRole {
  USER = 'user',
  SELLER = 'seller',
  SUPERADMIN = 'superadmin',
}

export enum SellerRequestStatus {
  NONE = 'none',
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  email!: string;

  @Column({ unique: true })
  username!: string;

  @Exclude()
  @Column({ name: 'password_hash', nullable: true, type: 'text' })
  passwordHash!: string | null;

  @Column({ type: 'text', nullable: true })
  bio!: string | null;

  @Column({ type: 'varchar', nullable: true })
  location!: string | null;

  @Column({ name: 'photo_url', nullable: true })
  photoUrl!: string;

  // Rol global del usuario en el sitio. Reemplaza al antiguo booleano
  // isSuperAdmin; 'seller' se activa cuando sellerRequestStatus pasa a
  // 'approved' (ver tarea 745).
  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.USER,
  })
  role!: UserRole;

  @Column({ type: 'varchar', nullable: true })
  locale!: string | null;

  @Column({ type: 'varchar', nullable: true })
  currency!: string | null;

  @Column({
    name: 'accepted_privacy_policy_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  acceptedPrivacyPolicyAt!: Date | null;

  @Column({ name: 'privacy_policy_version', default: '' })
  privacyPolicyVersion!: string;

  // Estado de la solicitud para convertirse en vendedor (tarea 745 agrega
  // los endpoints para solicitar/aprobar/rechazar).
  @Column({
    name: 'seller_request_status',
    type: 'enum',
    enum: SellerRequestStatus,
    default: SellerRequestStatus.NONE,
  })
  sellerRequestStatus!: SellerRequestStatus;

  @Column({
    name: 'seller_requested_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  sellerRequestedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

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

  @Exclude()
  @Column({ name: 'pending_email', nullable: true, type: 'varchar' })
  pendingEmail!: string | null;

  @Exclude()
  @Column({ name: 'email_change_token_hash', nullable: true, type: 'text' })
  emailChangeTokenHash!: string | null;

  @Exclude()
  @Column({
    name: 'email_change_expires_at',
    nullable: true,
    type: 'timestamp with time zone',
  })
  emailChangeExpiresAt!: Date | null;

  // Preferencias de notificación. Todavía no hay ningún envío real de email
  // ni push (el único flujo de correo hoy es el cambio de email); el primer
  // caso de uso real será notificar al aceptar/rechazar una
  // communityJoinRequest. Por ahora solo se guarda la preferencia.
  @Column({ name: 'email_notifications', type: 'boolean', default: true })
  emailNotifications!: boolean;

  @Column({ name: 'push_notifications', type: 'boolean', default: true })
  pushNotifications!: boolean;
}
