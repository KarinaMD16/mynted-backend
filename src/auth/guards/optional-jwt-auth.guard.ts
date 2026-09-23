import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Igual que JwtAuthGuard pero nunca bloquea la petición: si no hay
 * access_token (o es inválido), simplemente deja req.user como undefined en
 * vez de lanzar 401. Para endpoints públicos que dan mejor resultado si hay
 * usuario autenticado, pero también funcionan sin uno.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(
    _err: unknown,
    user: TUser | false,
  ): TUser | undefined {
    return user || undefined;
  }
}
