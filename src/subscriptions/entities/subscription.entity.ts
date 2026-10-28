import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { SubscriptionPeriod } from '../subscription-period.enum';

// Una fila por usuario que se extiende en cada pago; el historial vive en
// subscription_payment. El estado (none/active/cancelled/expired) no se
// guarda: se deriva de ends_at y cancel_at_period_end. Es Pro mientras
// ends_at > now().
@Entity('subscription')
@Unique('UQ_subscription_user_id', ['userId'])
// Barrido diario de avisos (por vencer y vencidas).
@Index('IDX_subscription_ends_at', ['endsAt'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user!: User;

  // Periodo del último pago aprobado.
  @Column({ type: 'enum', enum: SubscriptionPeriod })
  period!: SubscriptionPeriod;

  // Inicio del tramo vigente: se reinicia cuando se paga con la suscripción
  // vencida y no cambia al renovarla antes de que venza.
  @Column({ name: 'starts_at', type: 'timestamp with time zone' })
  startsAt!: Date;

  @Column({ name: 'ends_at', type: 'timestamp with time zone' })
  endsAt!: Date;

  // El usuario canceló: sigue siendo Pro hasta ends_at y no hay cobro
  // automático de todos modos (la renovación es manual). Pagar de nuevo lo
  // limpia.
  @Column({ name: 'cancel_at_period_end', type: 'boolean', default: false })
  cancelAtPeriodEnd!: boolean;

  // ends_at ya avisado como "por vencer" / "vencida". Se reclaman con un
  // UPDATE atómico: renovar cambia ends_at y permite avisar en el siguiente
  // ciclo.
  @Column({
    name: 'expiring_notified_for',
    type: 'timestamp with time zone',
    nullable: true,
  })
  expiringNotifiedFor!: Date | null;

  @Column({
    name: 'expired_notified_for',
    type: 'timestamp with time zone',
    nullable: true,
  })
  expiredNotifiedFor!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}
