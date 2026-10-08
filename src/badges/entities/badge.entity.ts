import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

export enum BadgeRarity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

// user: se otorga a la cuenta. community_profile: se otorga al perfil del
// usuario dentro de una comunidad concreta.
export enum BadgeScope {
  USER = 'user',
  COMMUNITY_PROFILE = 'community_profile',
}

@Entity('badge')
@Unique('UQ_badge_code', ['code'])
export class Badge {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  code!: string;

  @Column()
  name!: string;

  @Column({ type: 'text' })
  description!: string;

  // Texto que explica cómo se consigue.
  @Column({ type: 'text' })
  criteria!: string;

  // SVG o URL del ícono. El equipo todavía no decide si va a Cloudinary o
  // en el código; por ahora es un string libre (null = sin ícono).
  @Column({ type: 'text', nullable: true })
  icon!: string | null;

  @Column({ type: 'enum', enum: BadgeRarity })
  rarity!: BadgeRarity;

  @Column({ type: 'enum', enum: BadgeScope })
  scope!: BadgeScope;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;
}
