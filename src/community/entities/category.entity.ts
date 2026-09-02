import {
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Community } from './community.entity';

@Entity('category')
@Unique('UQ_category_name', ['name'])
export class Category {
  @PrimaryGeneratedColumn({ name: 'category_id' })
  categoryId!: number;

  @Column()
  name!: string;

  @OneToMany(() => Community, (community) => community.category)
  communities!: Community[];
}
