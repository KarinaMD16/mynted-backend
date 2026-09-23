import { ConfigService } from '@nestjs/config';
import { Response } from 'express';

const DEFAULT_ACCESS_EXPIRES_IN_SECONDS = 900; // 15 min
const DEFAULT_REFRESH_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7; // 7 días

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

function getExpiresInMs(
  configService: ConfigService,
  envKey: string,
  defaultSeconds: number,
): number {
  const seconds = parseInt(
    configService.get<string>(envKey) ?? String(defaultSeconds),
    10,
  );
  return seconds * 1000;
}

/**
 * Setea access_token y refresh_token como cookies httpOnly. Compartido entre
 * AuthController (login/refresh/OAuth) y UsersController (registro, que
 * inicia sesión automáticamente) para no duplicar la configuración.
 */
export function setAuthCookies(
  res: Response,
  tokens: AuthTokens,
  configService: ConfigService,
): void {
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // en local (http) tiene que ir false
    sameSite: 'lax' as const,
  };

  res.cookie('access_token', tokens.accessToken, {
    ...cookieOptions,
    maxAge: getExpiresInMs(
      configService,
      'JWT_EXPIRES_IN_SECONDS',
      DEFAULT_ACCESS_EXPIRES_IN_SECONDS,
    ),
  });

  res.cookie('refresh_token', tokens.refreshToken, {
    ...cookieOptions,
    maxAge: getExpiresInMs(
      configService,
      'JWT_REFRESH_EXPIRES_IN_SECONDS',
      DEFAULT_REFRESH_EXPIRES_IN_SECONDS,
    ),
  });
}
