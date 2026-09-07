import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Category } from './category.entity';
import { CommunityTag } from './community-tag.entity';
import { UserTag } from '../../user-tags/entities/user-tag.entity';

@Entity('tag')
@Unique('UQ_tag_name', ['name'])
export class Tag {
  @PrimaryGeneratedColumn({ name: 'tag_id' })
  tagId!: number;

  @Column()
  name!: string;

  @Column({ name: 'category_id', nullable: true })
  categoryId!: number | null;

  @ManyToOne(() => Category, (category) => category.tags, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'category_id', referencedColumnName: 'categoryId' })
  category!: Category | null;

  // Distingue los tags "principales" que gestiona el superadmin y que
  // aparecen en el picker de onboarding, de los tags hiper específicos que
  // surgen al etiquetar comunidades/posts/productos (usados para búsqueda y
  // filtrado fino), que no deben ensuciar el onboarding.
  @Column({ name: 'is_interest', default: false })
  isInterest!: boolean;

  @OneToMany(() => CommunityTag, (communityTag) => communityTag.tag)
  communityTags!: CommunityTag[];

  @OneToMany(() => UserTag, (userTag) => userTag.tag)
  userTags!: UserTag[];
}
