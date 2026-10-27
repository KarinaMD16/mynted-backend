import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './strategies/jwt.strategy';

describe('JwtStrategy', () => {
  const config = {
    get: () => 'test-secret',
  } as unknown as ConfigService;

  it('rechaza usuarios inactivos aunque el payload sea válido', async () => {
    const usersService = {
      findById: jest.fn().mockResolvedValue({ isActive: false }),
    };
    const strategy = new JwtStrategy(config, usersService as never);

    await expect(
      strategy.validate({ sub: 'user-1', email: 'a@b.cr' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('mantiene el contexto autenticado para usuarios activos', async () => {
    const usersService = {
      findById: jest.fn().mockResolvedValue({ isActive: true }),
    };
    const strategy = new JwtStrategy(config, usersService as never);

    await expect(
      strategy.validate({ sub: 'user-1', email: 'a@b.cr' }),
    ).resolves.toEqual({ userId: 'user-1', email: 'a@b.cr' });
  });
});
