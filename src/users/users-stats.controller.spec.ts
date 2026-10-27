import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController stats', () => {
  it('protects GET /users/stats with JWT and SuperAdminGuard', () => {
    const handler = Object.getOwnPropertyDescriptor(
      UsersController.prototype,
      'getStats',
    )?.value as object;

    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual(
      expect.arrayContaining([JwtAuthGuard, SuperAdminGuard]),
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('stats');
  });

  it('delegates stats without adding pagination or personal data', async () => {
    const service = {
      getStats: jest.fn().mockResolvedValue({
        totalUsers: 1,
        approvedSellers: 0,
        activeCommunities: 1,
        activeProducts: 0,
        pendingReports: 0,
      }),
    };
    const controller = new UsersController(
      service as unknown as UsersService,
      undefined as never,
      undefined as never,
    );

    await expect(controller.getStats()).resolves.toEqual({
      totalUsers: 1,
      approvedSellers: 0,
      activeCommunities: 1,
      activeProducts: 0,
      pendingReports: 0,
    });
    expect(service.getStats).toHaveBeenCalledWith();
  });
});
