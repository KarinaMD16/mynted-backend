import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy } from 'passport-jwt';
import { Request } from 'express';
import { UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../../users/users.service';

export interface AccessTokenPayload {
  sub: string;
  email: string;
}

// Exportados para que el handshake de socket.io (WsJwtAuthenticator) lea y
// valide el token exactamente igual que las rutas HTTP.
export const cookieExtractor = (req: Request): string | null => {
  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.['access_token'] ?? null;
};

export const toAuthenticatedUser = (payload: AccessTokenPayload) => ({
  userId: payload.sub,
  email: payload.email,
});

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: cookieExtractor,
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET')!,
    });
  }

  async validate(payload: AccessTokenPayload) {
    try {
      const user = await this.usersService.findById(payload.sub);
      if (!user.isActive) throw new UnauthorizedException('Cuenta inactiva');
      return toAuthenticatedUser(payload);
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Sesión inválida o vencida');
    }
  }
}
