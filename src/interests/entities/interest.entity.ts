import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('interests')
export class Interest {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  name!: string;
}
