import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy } from 'passport-jwt';
import { Request } from 'express';

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
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: cookieExtractor,
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET')!,
    });
  }

  validate(payload: AccessTokenPayload) {
    return toAuthenticatedUser(payload);
  }
}
