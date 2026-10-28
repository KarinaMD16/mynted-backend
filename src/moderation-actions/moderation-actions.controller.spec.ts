import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { ModerationActionQueryDto } from './dto/moderation-action-query.dto';
import { ModerationActionsController } from './moderation-actions.controller';

describe('ModerationActionsController', () => {
  it('protects the global log with JWT and SuperAdminGuard', async () => {
    const service = { findAll: jest.fn().mockResolvedValue({}) };
    const controller = new ModerationActionsController(service as never);
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ModerationActionsController,
    ) as unknown[];

    await controller.findAll(
      Object.assign(new ModerationActionQueryDto(), {
        page: 1,
        limit: 20,
      }),
    );

    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, SuperAdminGuard]),
    );
    expect(service.findAll).toHaveBeenCalled();
  });
});
