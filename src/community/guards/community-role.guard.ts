import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthenticatedRequest } from '../../auth/types/authenticated-request';
import { COMMUNITY_ROLES_KEY } from '../decorators/require-community-role.decorator';
import { CommunityProfile } from '../entities/community-profile.entity';
import { Community } from '../entities/community.entity';

/**
 * Debe usarse después de JwtAuthGuard (@UseGuards(JwtAuthGuard, CommunityRoleGuard))
 * combinado con @RequireCommunityRole(...roles). Resuelve el communityProfile
 * del usuario autenticado (req.user.userId) en la comunidad indicada por
 * :communityId en los params de la ruta, y exige que su role esté entre los
 * permitidos. Es independiente de SuperAdminGuard (rol global de user, no de
 * comunidad): ninguno depende del otro.
 */
@Injectable()
export class CommunityRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(CommunityProfile)
    private readonly communityProfileRepository: Repository<CommunityProfile>,
    @InjectRepository(Community)
    private readonly communityRepository: Repository<Community>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowedRoles = this.reflector.get<string[] | undefined>(
      COMMUNITY_ROLES_KEY,
      context.getHandler(),
    );

    if (!allowedRoles || allowedRoles.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const communityId = Number(req.params.communityId);

    const profile = await this.communityProfileRepository.findOne({
      where: { userId: req.user.userId, communityId },
    });

    if (!profile || !allowedRoles.includes(profile.role)) {
      const community = await this.communityRepository.findOne({
        where: { id: communityId },
        select: { id: true },
      });

      if (!community) {
        throw new NotFoundException('Comunidad no encontrada');
      }

      throw new ForbiddenException(
        'No tienes permisos para administrar esta comunidad',
      );
    }

    return true;
  }
}
