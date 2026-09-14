import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy } from 'passport-jwt';
import { Request } from 'express';

const refreshCookieExtractor = (req: Request): string | null => {
  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.['refresh_token'] ?? null;
};

// Estrategia separada de JwtStrategy: mismo patrón (lee la cookie, valida
// firma y expiración), pero contra JWT_REFRESH_SECRET y la cookie
// refresh_token en lugar de access_token. El nombre 'jwt-refresh' evita que
// choque con la estrategia 'jwt' por defecto.
@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: refreshCookieExtractor,
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_REFRESH_SECRET')!,
    });
  }

  validate(payload: { sub: string }) {
    return { userId: payload.sub };
  }
}
