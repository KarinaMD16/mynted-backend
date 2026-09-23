import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UsersService } from '../../users/users.service';
import { UserRole } from '../../users/entities/user.entity';
import { AuthenticatedRequest } from '../types/authenticated-request';

/**
 * Debe usarse después de JwtAuthGuard (@UseGuards(JwtAuthGuard, SellerGuard))
 * ya que depende de req.user, que lo llena la estrategia JWT. Exige que el
 * usuario tenga el rol global 'seller' (se activa cuando sellerRequestStatus
 * pasa a 'approved', ver tarea 928).
 */
@Injectable()
export class SellerGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.usersService.findById(req.user.userId);

    if (user.role !== UserRole.SELLER) {
      throw new ForbiddenException('Requiere ser un vendedor aprobado');
    }

    return true;
  }
}
