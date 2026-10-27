import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportItemType } from './enums/report-item-type.enum';
import { ReportReason } from './enums/report-reason.enum';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';

describe('ReportsController', () => {
  it('uses the authenticated user id instead of a body reporter id', async () => {
    const service = { createReport: jest.fn().mockResolvedValue({ id: 1 }) };
    const controller = new ReportsController(
      service as unknown as ReportsService,
    );
    const request = { user: { userId: 'jwt-user', email: 'user@test.com' } };
    const body = {
      itemType: ReportItemType.POST,
      itemId: 1,
      reason: ReportReason.SPAM,
      reporterId: 'body-user',
    };

    await controller.create(body, request as never);

    expect(service.createReport).toHaveBeenCalledWith('jwt-user', body);
  });

  it('protects global report routes with JWT and SuperAdminGuard', () => {
    const handlers = ['list', 'resolve', 'dismiss'];
    for (const method of handlers) {
      const handler = Object.getOwnPropertyDescriptor(
        ReportsController.prototype,
        method,
      )?.value as object;
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual(
        expect.arrayContaining([JwtAuthGuard, SuperAdminGuard]),
      );
    }
  });

  it('delegates global listing and actions using the authenticated user', async () => {
    const service = {
      listGlobalReports: jest.fn().mockResolvedValue({}),
      resolveGlobalReport: jest.fn().mockResolvedValue({}),
      dismissGlobalReport: jest.fn().mockResolvedValue({}),
    };
    const controller = new ReportsController(
      service as unknown as ReportsService,
    );
    const query = { page: 1, limit: 20 };
    const request = { user: { userId: 'superadmin-id' } };
    const dto = { note: 'Nota' };

    await controller.list(query);
    await controller.resolve(10, dto, request as never);
    await controller.dismiss(10, request as never);

    expect(service.listGlobalReports).toHaveBeenCalledWith(query);
    expect(service.resolveGlobalReport).toHaveBeenCalledWith(
      10,
      dto,
      'superadmin-id',
    );
    expect(service.dismissGlobalReport).toHaveBeenCalledWith(
      10,
      'superadmin-id',
    );
  });
});
