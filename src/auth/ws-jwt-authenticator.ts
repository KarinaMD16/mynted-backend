import { Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import cookieParser from 'cookie-parser';
import { Request } from 'express';
import { IncomingMessage } from 'node:http';
import {
  AccessTokenPayload,
  cookieExtractor,
  toAuthenticatedUser,
} from './strategies/jwt.strategy';
import { UsersService } from '../users/users.service';

const parseCookies = cookieParser();

/**
 * Autentica el handshake de socket.io con la misma regla que JwtAuthGuard:
 * solo la cookie httpOnly access_token (no hay Bearer ni auth.token, igual
 * que en HTTP), firmada con JWT_SECRET y sin vencer. Las cookies se parsean
 * con el mismo cookie-parser que main.ts y se extraen con el mismo
 * cookieExtractor de JwtStrategy.
 */
@Injectable()
export class WsJwtAuthenticator {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Optional() private readonly usersService?: UsersService,
  ) {}

  async authenticate(request: IncomingMessage) {
    const req = request as Request;
    if (!req.cookies) parseCookies(req, {} as never, () => undefined);

    const token = cookieExtractor(req);
    if (!token) throw new UnauthorizedException('Falta la cookie de sesión');

    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(
        token,
        { secret: this.configService.get<string>('JWT_SECRET') },
      );
      if (this.usersService) {
        const user = await this.usersService.findById(payload.sub);
        if (!user.isActive || user.deletedAt) {
          throw new UnauthorizedException('Cuenta inactiva');
        }
      }
      return toAuthenticatedUser(payload);
    } catch {
      throw new UnauthorizedException('Sesión inválida o vencida');
    }
  }
}
