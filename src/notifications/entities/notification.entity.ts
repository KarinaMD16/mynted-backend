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
import { NotificationType } from '../enums/notification-type.enum';

// Notificación in-app de un usuario. Se guarda siempre y se emite por socket
// a la sala user:{id}. message es un texto de respaldo en español: el front
// arma el texto desde type + data.
@Entity('notification')
// Listado del usuario ordenado por fecha (Postgres recorre el índice al revés
// para created_at DESC).
@Index('IDX_notification_user_id_created_at', ['userId', 'createdAt'])
// Parcial: solo las no leídas (contador y "marcar todas como leídas").
@Index('IDX_notification_unread_user_id', ['userId'], {
  where: '"read_at" IS NULL',
})
// Unificación (precio y disponibilidad de favoritos): una sola no leída por
// usuario y clave. Al leerla, la siguiente crea una nueva.
@Index('UQ_notification_user_id_dedupe_key', ['userId', 'dedupeKey'], {
  unique: true,
  where: '"read_at" IS NULL AND "dedupe_key" IS NOT NULL',
})
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user!: User;

  @Column({ type: 'enum', enum: NotificationType })
  type!: NotificationType;

  // Lo mínimo para armar el texto y el enlace: ids, nombres y montos.
  @Column({ type: 'jsonb' })
  data!: Record<string, unknown>;

  @Column({ type: 'text' })
  message!: string;

  @Column({ name: 'dedupe_key', type: 'varchar', nullable: true })
  dedupeKey!: string | null;

  @Column({ name: 'read_at', type: 'timestamp with time zone', nullable: true })
  readAt!: Date | null;

  // Al unificar se renueva para que la notificación vuelva arriba.
  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;
}
