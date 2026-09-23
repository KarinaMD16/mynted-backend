import { SetMetadata } from '@nestjs/common';
import { CommunityProfileRole } from '../entities/community-profile.entity';

export const COMMUNITY_ROLES_KEY = 'communityRoles';

/**
 * Úsalo junto a @UseGuards(JwtAuthGuard, CommunityRoleGuard) para restringir
 * un endpoint a los roles que el usuario autenticado tenga en el
 * communityProfile de la comunidad indicada por :communityId en la ruta.
 */
export const RequireCommunityRole = (...roles: CommunityProfileRole[]) =>
  SetMetadata(COMMUNITY_ROLES_KEY, roles);
