import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer';
import { ExchangeRateType } from '../enums/exchange-rate-type.enum';

@Entity('exchange_rate_snapshot')
@Unique('UQ_exchange_rate_snapshot_pair_type_date', [
  'fromCurrency',
  'toCurrency',
  'rateType',
  'rateDate',
])
export class ExchangeRateSnapshot {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'from_currency', type: 'varchar', length: 3 })
  fromCurrency!: string;

  @Column({ name: 'to_currency', type: 'varchar', length: 3 })
  toCurrency!: string;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 6,
    transformer: numericTransformer,
  })
  rate!: number;

  @Column({ name: 'rate_date', type: 'date' })
  rateDate!: string;

  @Column({ type: 'varchar', length: 32 })
  source!: string;

  @Column({ name: 'indicator_code', type: 'integer' })
  indicatorCode!: number;

  @Column({ name: 'rate_type', type: 'enum', enum: ExchangeRateType })
  rateType!: ExchangeRateType;

  @CreateDateColumn({ name: 'fetched_at', type: 'timestamp with time zone' })
  fetchedAt!: Date;
}
