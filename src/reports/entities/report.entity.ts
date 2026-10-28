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
import { Community } from '../../community/entities/community.entity';
import { User } from '../../users/entities/user.entity';
import { ReportItemType } from '../enums/report-item-type.enum';
import { ReportReason } from '../enums/report-reason.enum';
import { ReportStatus } from '../enums/report-status.enum';

@Entity('report')
@Unique('UQ_report_reporter_id_item_type_item_id', [
  'reporterId',
  'itemType',
  'itemId',
])
@Index('IDX_report_item_type_item_id', ['itemType', 'itemId'])
@Index('IDX_report_status_created_at', ['status', 'createdAt'])
export class Report {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'reporter_id', type: 'uuid' })
  reporterId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'reporter_id', referencedColumnName: 'id' })
  reporter!: User;

  @Column({ name: 'community_id', type: 'int', nullable: true })
  communityId!: number | null;

  @ManyToOne(() => Community, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'community_id', referencedColumnName: 'id' })
  community!: Community | null;

  @Column({ name: 'item_type', type: 'enum', enum: ReportItemType })
  itemType!: ReportItemType;

  @Column({ name: 'item_id', type: 'int' })
  itemId!: number;

  @Column({ type: 'enum', enum: ReportReason })
  reason!: ReportReason;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'enum', enum: ReportStatus, default: ReportStatus.PENDING })
  status!: ReportStatus;

  @Column({
    name: 'resolved_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  resolvedAt!: Date | null;

  @Column({ name: 'resolved_by_user_id', type: 'uuid', nullable: true })
  resolvedByUserId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resolved_by_user_id', referencedColumnName: 'id' })
  resolvedByUser!: User | null;

  @Column({ name: 'resolution_action', type: 'varchar', nullable: true })
  resolutionAction!: string | null;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}
