import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

export enum BadgeRarity {
  COMMON = 'common',
  UNCOMMON = 'uncommon',
  RARE = 'rare',
  EPIC = 'epic',
  LEGENDARY = 'legendary',
}

// user: se otorga a la cuenta (user_badge). community: se otorga al perfil del
// usuario en una comunidad concreta (community_profile_badge).
export enum BadgeScope {
  USER = 'user',
  COMMUNITY = 'community',
}

// Qué se mide para otorgar el badge; `threshold` es el valor a alcanzar.
// null en los badges por evento (verified_seller), derivados y pendientes.
export enum BadgeMetric {
  // Posición de registro del usuario (se gana si es <= threshold).
  REGISTRATION_RANK = 'registration_rank',
  // Días desde user.createdAt.
  ACCOUNT_AGE_DAYS = 'account_age_days',
  // Posts del perfil en la comunidad.
  COMMUNITY_POSTS = 'community_posts',
  // Replies del perfil en la comunidad.
  COMMUNITY_REPLIES = 'community_replies',
  // Upvotes acumulados en los posts del perfil.
  COMMUNITY_UPVOTES = 'community_upvotes',
  // Productos publicados + favoritos del usuario en la comunidad.
  COMMUNITY_COLLECTION = 'community_collection',
  // Posición del perfil entre los miembros de la comunidad (<= threshold).
  COMMUNITY_MEMBER_RANK = 'community_member_rank',
}

// El ícono NO se guarda en el backend: los SVG viven en el frontend y se
// asocian por `code`, que es el contrato estable con el front.
@Entity('badge')
@Unique('UQ_badge_code', ['code'])
export class Badge {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  code!: string;

  // Textos de respaldo en español; el front traduce por code.
  @Column()
  name!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'enum', enum: BadgeScope })
  scope!: BadgeScope;

  @Column({ type: 'enum', enum: BadgeRarity })
  rarity!: BadgeRarity;

  @Column({ type: 'enum', enum: BadgeMetric, nullable: true })
  metric!: BadgeMetric | null;

  @Column({ type: 'int', nullable: true })
  threshold!: number | null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;
}
