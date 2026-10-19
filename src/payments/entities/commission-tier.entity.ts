import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer';
import { CommissionTierType } from '../enums/commission-tier-type.enum';

@Entity('commission_tier')
export class CommissionTier {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'enum', enum: CommissionTierType })
  type!: CommissionTierType;

  @Column()
  name!: string;

  @Column({
    name: 'min_value',
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: numericTransformer,
  })
  minValue!: number;

  @Column({
    name: 'max_value',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  maxValue!: number | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  currency!: string | null;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 4,
    transformer: numericTransformer,
  })
  discount!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;
}
