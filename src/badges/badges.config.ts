import { BadgeMetric, BadgeRarity, BadgeScope } from './entities/badge.entity';

// Los `code` son el contrato estable con el frontend (ahí viven los SVG):
// no se renombran una vez sembrados.
export const BADGE_CODES = {
  // scope user
  VERIFIED_SELLER: 'verified_seller',
  TRUSTED_SELLER: 'trusted_seller',
  SUCCESSFUL_EXCHANGE: 'successful_exchange',
  FOUNDING_MEMBER: 'founding_member',
  ANNIVERSARY: 'anniversary',
  // Derivado de la suscripción Pro vigente (nunca se otorga ni se guarda).
  PRO: 'pro',
  // scope community
  FIRST_POST: 'first_post',
  TALKATIVE: 'talkative',
  COMMUNITY_VOICE: 'community_voice',
  COMMUNITY_COLLECTOR: 'community_collector',
  COMMUNITY_FOUNDING_MEMBER: 'community_founding_member',
  COMMUNITY_FOUNDER: 'community_founder',
  MODERATOR: 'moderator',
} as const;

// Badges derivados: existen en el catálogo pero NO se guardan en tablas
// intermedias (se calcularían desincronizados al cambiar su origen).
// owner -> community_founder y moderator -> moderator (rol del communityProfile);
// pro -> suscripción Pro vigente (aparece y desaparece con ends_at).
export const DERIVED_BADGE_CODES: ReadonlySet<string> = new Set([
  BADGE_CODES.COMMUNITY_FOUNDER,
  BADGE_CODES.MODERATOR,
  BADGE_CODES.PRO,
]);

export interface BadgeDefinition {
  code: string;
  name: string;
  description: string;
  scope: BadgeScope;
  rarity: BadgeRarity;
  metric: BadgeMetric | null;
  threshold: number | null;
}

// Catálogo base. threshold es el valor inicial: después se ajusta en la base
// de datos sin tocar código (el seed no lo pisa).
export const BASE_BADGES: BadgeDefinition[] = [
  // ---- scope user
  {
    code: BADGE_CODES.VERIFIED_SELLER,
    name: 'Vendedor verificado',
    description:
      'Su solicitud de vendedor fue aprobada por el equipo de Mynted.',
    scope: BadgeScope.USER,
    rarity: BadgeRarity.UNCOMMON,
    metric: null,
    threshold: null,
  },
  {
    // TODO: sin otorgamiento hasta que exista el módulo de transacciones
    // (ventas completadas + rating).
    code: BADGE_CODES.TRUSTED_SELLER,
    name: 'Vendedor confiable',
    description: 'Un vendedor con ventas completadas y buena reputación.',
    scope: BadgeScope.USER,
    rarity: BadgeRarity.RARE,
    metric: null,
    threshold: null,
  },
  {
    // TODO: sin otorgamiento hasta que exista el módulo de transacciones.
    code: BADGE_CODES.SUCCESSFUL_EXCHANGE,
    name: 'Intercambio exitoso',
    description: 'Completó un intercambio con otro coleccionista.',
    scope: BadgeScope.USER,
    rarity: BadgeRarity.UNCOMMON,
    metric: null,
    threshold: null,
  },
  {
    code: BADGE_CODES.FOUNDING_MEMBER,
    name: 'Miembro fundador',
    description: 'Estuvo entre los primeros usuarios registrados en Mynted.',
    scope: BadgeScope.USER,
    rarity: BadgeRarity.LEGENDARY,
    metric: BadgeMetric.REGISTRATION_RANK,
    threshold: 100,
  },
  {
    code: BADGE_CODES.ANNIVERSARY,
    name: 'Aniversario',
    description: 'Cumplió un año en Mynted.',
    scope: BadgeScope.USER,
    rarity: BadgeRarity.RARE,
    metric: BadgeMetric.ACCOUNT_AGE_DAYS,
    threshold: 365,
  },
  {
    // Derivado de la suscripción: visible mientras ends_at > now().
    code: BADGE_CODES.PRO,
    name: 'Pro',
    description: 'Tiene Mynted Pro activo.',
    scope: BadgeScope.USER,
    rarity: BadgeRarity.EPIC,
    metric: null,
    threshold: null,
  },
  // ---- scope community
  {
    code: BADGE_CODES.FIRST_POST,
    name: 'Primera publicación',
    description: 'Hizo su primera publicación en esta comunidad.',
    scope: BadgeScope.COMMUNITY,
    rarity: BadgeRarity.COMMON,
    metric: BadgeMetric.COMMUNITY_POSTS,
    threshold: 1,
  },
  {
    code: BADGE_CODES.TALKATIVE,
    name: 'Conversador',
    description: 'Siempre tiene algo que aportar a la conversación.',
    scope: BadgeScope.COMMUNITY,
    rarity: BadgeRarity.UNCOMMON,
    metric: BadgeMetric.COMMUNITY_REPLIES,
    threshold: 25,
  },
  {
    code: BADGE_CODES.COMMUNITY_VOICE,
    name: 'Voz de la comunidad',
    description: 'Sus publicaciones acumulan muchos upvotes en esta comunidad.',
    scope: BadgeScope.COMMUNITY,
    rarity: BadgeRarity.RARE,
    metric: BadgeMetric.COMMUNITY_UPVOTES,
    threshold: 50,
  },
  {
    // Plantilla: al otorgarse al communityProfile queda ligado a la
    // comunidad/franquicia ("Coleccionista de [Franquicia]").
    code: BADGE_CODES.COMMUNITY_COLLECTOR,
    name: 'Coleccionista',
    description: 'Dedicado a la colección de esta comunidad.',
    scope: BadgeScope.COMMUNITY,
    rarity: BadgeRarity.RARE,
    metric: BadgeMetric.COMMUNITY_COLLECTION,
    threshold: 10,
  },
  {
    code: BADGE_CODES.COMMUNITY_FOUNDING_MEMBER,
    name: 'Miembro fundador de la comunidad',
    description: 'Estuvo entre los primeros miembros de esta comunidad.',
    scope: BadgeScope.COMMUNITY,
    rarity: BadgeRarity.EPIC,
    metric: BadgeMetric.COMMUNITY_MEMBER_RANK,
    threshold: 25,
  },
  {
    // Derivado de communityProfile.role = owner.
    code: BADGE_CODES.COMMUNITY_FOUNDER,
    name: 'Fundador de la comunidad',
    description: 'Creó esta comunidad.',
    scope: BadgeScope.COMMUNITY,
    rarity: BadgeRarity.EPIC,
    metric: null,
    threshold: null,
  },
  {
    // Derivado de communityProfile.role = moderator.
    code: BADGE_CODES.MODERATOR,
    name: 'Moderador',
    description: 'Ayuda a cuidar esta comunidad.',
    scope: BadgeScope.COMMUNITY,
    rarity: BadgeRarity.RARE,
    metric: null,
    threshold: null,
  },
];
