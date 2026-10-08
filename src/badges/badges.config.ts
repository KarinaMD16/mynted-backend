import { BadgeRarity, BadgeScope } from './entities/badge.entity';

// Umbrales para otorgar badges. Son valores propuestos: se ajustan aquí sin
// tocar la lógica.
export const BADGE_THRESHOLDS = {
  // Posts publicados en una misma comunidad.
  COMMUNITY_VOICE_MIN_POSTS: 20,
  // Respuestas escritas en total (todas las comunidades).
  CONVERSATIONALIST_MIN_REPLIES: 50,
  // Posts + productos publicados que comparten un mismo tag (la "franquicia").
  FRANCHISE_COLLECTOR_MIN_ITEMS: 5,
  // Se es miembro fundador si se está entre los primeros N de la comunidad.
  FOUNDING_MEMBER_LIMIT: 10,
  // Años desde que se creó la cuenta.
  ANNIVERSARY_YEARS: 1,
  // TODO: depende del módulo de transacciones (no existe aún); sin
  // otorgamiento automático por ahora.
  TRUSTED_SELLER_MIN_SALES: 5,
} as const;

export const BADGE_CODES = {
  FIRST_POST: 'first_post',
  COMMUNITY_VOICE: 'community_voice',
  CONVERSATIONALIST: 'conversationalist',
  FRANCHISE_COLLECTOR: 'franchise_collector',
  COMMUNITY_FOUNDER: 'community_founder',
  MODERATOR: 'moderator',
  VERIFIED_SELLER: 'verified_seller',
  FOUNDING_MEMBER: 'founding_member',
  ANNIVERSARY: 'anniversary',
  // Sin otorgamiento automático hasta que exista el módulo de transacciones.
  TRUSTED_SELLER: 'trusted_seller',
  SUCCESSFUL_EXCHANGE: 'successful_exchange',
} as const;

export interface BadgeDefinition {
  code: string;
  name: string;
  description: string;
  criteria: string;
  rarity: BadgeRarity;
  scope: BadgeScope;
}

export const BASE_BADGES: BadgeDefinition[] = [
  {
    code: BADGE_CODES.FIRST_POST,
    name: 'Primera publicación',
    description: 'Compartió su primera publicación en una comunidad.',
    criteria: 'Publica tu primer post en cualquier comunidad.',
    rarity: BadgeRarity.LOW,
    scope: BadgeScope.USER,
  },
  {
    code: BADGE_CODES.COMMUNITY_VOICE,
    name: 'Voz de la comunidad',
    description: 'Es una voz activa de esta comunidad.',
    criteria: `Publica ${BADGE_THRESHOLDS.COMMUNITY_VOICE_MIN_POSTS} posts en una misma comunidad.`,
    rarity: BadgeRarity.MEDIUM,
    scope: BadgeScope.COMMUNITY_PROFILE,
  },
  {
    code: BADGE_CODES.CONVERSATIONALIST,
    name: 'Conversador',
    description: 'Siempre tiene algo que aportar a la conversación.',
    criteria: `Escribe ${BADGE_THRESHOLDS.CONVERSATIONALIST_MIN_REPLIES} respuestas en las comunidades.`,
    rarity: BadgeRarity.MEDIUM,
    scope: BadgeScope.USER,
  },
  {
    code: BADGE_CODES.FRANCHISE_COLLECTOR,
    name: 'Coleccionista de franquicia',
    description: 'Dedicado a una franquicia en particular.',
    criteria: `Publica ${BADGE_THRESHOLDS.FRANCHISE_COLLECTOR_MIN_ITEMS} posts o productos con un mismo tag.`,
    rarity: BadgeRarity.MEDIUM,
    scope: BadgeScope.USER,
  },
  {
    code: BADGE_CODES.COMMUNITY_FOUNDER,
    name: 'Fundador de comunidad',
    description: 'Creó esta comunidad.',
    criteria: 'Crea una comunidad (propietario).',
    rarity: BadgeRarity.HIGH,
    scope: BadgeScope.COMMUNITY_PROFILE,
  },
  {
    code: BADGE_CODES.MODERATOR,
    name: 'Moderador',
    description: 'Ayuda a cuidar esta comunidad.',
    criteria: 'Ser nombrado moderador de una comunidad.',
    rarity: BadgeRarity.MEDIUM,
    scope: BadgeScope.COMMUNITY_PROFILE,
  },
  {
    code: BADGE_CODES.VERIFIED_SELLER,
    name: 'Vendedor verificado',
    description: 'Su cuenta de vendedor fue verificada por el equipo.',
    criteria: 'Que se apruebe tu solicitud de vendedor.',
    rarity: BadgeRarity.MEDIUM,
    scope: BadgeScope.USER,
  },
  {
    code: BADGE_CODES.FOUNDING_MEMBER,
    name: 'Miembro fundador',
    description: 'Estuvo entre los primeros miembros de esta comunidad.',
    criteria: `Ser uno de los primeros ${BADGE_THRESHOLDS.FOUNDING_MEMBER_LIMIT} miembros de una comunidad.`,
    rarity: BadgeRarity.HIGH,
    scope: BadgeScope.COMMUNITY_PROFILE,
  },
  {
    code: BADGE_CODES.ANNIVERSARY,
    name: 'Aniversario',
    description: 'Cumplió años en Mynted.',
    criteria: `Mantén tu cuenta ${BADGE_THRESHOLDS.ANNIVERSARY_YEARS} año o más.`,
    rarity: BadgeRarity.LOW,
    scope: BadgeScope.USER,
  },
  {
    // TODO: otorgar automáticamente cuando exista el módulo de transacciones.
    code: BADGE_CODES.TRUSTED_SELLER,
    name: 'Vendedor confiable',
    description: 'Un vendedor con ventas completadas y buena reputación.',
    criteria: `Completa ${BADGE_THRESHOLDS.TRUSTED_SELLER_MIN_SALES} ventas o más.`,
    rarity: BadgeRarity.HIGH,
    scope: BadgeScope.USER,
  },
  {
    // TODO: otorgar automáticamente cuando exista el módulo de transacciones.
    code: BADGE_CODES.SUCCESSFUL_EXCHANGE,
    name: 'Intercambio exitoso',
    description: 'Completó un intercambio con otro coleccionista.',
    criteria: 'Completa un intercambio.',
    rarity: BadgeRarity.MEDIUM,
    scope: BadgeScope.USER,
  },
];
