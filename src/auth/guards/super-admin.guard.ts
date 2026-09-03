import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UsersService } from '../../users/users.service';
import { AuthenticatedRequest } from '../types/authenticated-request';

/**
 * Debe usarse después de JwtAuthGuard (@UseGuards(JwtAuthGuard, SuperAdminGuard))
 * ya que depende de req.user, que lo llena la estrategia JWT.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.usersService.findById(req.user.userId);

    if (!user.isSuperAdmin) {
      throw new ForbiddenException('Requiere permisos de superadministrador');
    }

    return true;
  }
}
