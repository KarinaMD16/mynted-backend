import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum PaymentType {
  BANK_ACCOUNT = 'bank_account',
  PAYPAL = 'paypal',
}

@Entity('payment_info')
export class PaymentInfo {
  @PrimaryGeneratedColumn({ name: 'payment_info_id' })
  paymentInfoId!: number;

  @Column({ name: 'owner_full_name' })
  ownerFullName!: string;

  @Column()
  name!: string;

  @Column()
  number!: string;

  @Column({ type: 'enum', enum: PaymentType })
  type!: PaymentType;
}
