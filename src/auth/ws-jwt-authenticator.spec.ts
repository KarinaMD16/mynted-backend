import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { IncomingMessage } from 'node:http';
import { WsJwtAuthenticator } from './ws-jwt-authenticator';

describe('WsJwtAuthenticator', () => {
  const secret = 'test-secret';
  const jwt = new JwtService({ secret });
  const authenticator = new WsJwtAuthenticator(new JwtService({}), {
    get: () => secret,
  } as unknown as ConfigService);

  const handshake = (cookie?: string) =>
    ({ headers: cookie ? { cookie } : {} }) as IncomingMessage;

  it('authenticates with the access_token cookie like JwtStrategy', async () => {
    const token = jwt.sign({ sub: 'user-1', email: 'a@b.cr' });

    await expect(
      authenticator.authenticate(
        handshake(`theme=dark; access_token=${token}`),
      ),
    ).resolves.toEqual({ userId: 'user-1', email: 'a@b.cr' });
  });

  it.each([
    ['no cookie', undefined],
    ['another cookie only', 'refresh_token=abc'],
    ['a malformed token', 'access_token=no-es-un-jwt'],
    [
      'a token signed with another secret',
      `access_token=${new JwtService({ secret: 'otro' }).sign({ sub: 'u' })}`,
    ],
    [
      'an expired token',
      `access_token=${jwt.sign({ sub: 'u', email: 'e' }, { expiresIn: -10 })}`,
    ],
  ])('rejects %s', async (_label, cookie) => {
    await expect(authenticator.authenticate(handshake(cookie))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
