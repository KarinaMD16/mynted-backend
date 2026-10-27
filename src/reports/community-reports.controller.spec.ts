import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CommunityReportsController } from './community-reports.controller';
import { CommunityReportsQueryDto } from './dto/community-reports-query.dto';
import { CommunityRoleGuard } from '../community/guards/community-role.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('CommunityReportsController', () => {
  const service = {
    listCommunityReports: jest.fn(),
    getCommunityReportDetail: jest.fn(),
    getModerationStats: jest.fn(),
    resolveCommunityReport: jest.fn(),
    dismissCommunityReport: jest.fn(),
  };
  const controller = new CommunityReportsController(service as never);

  beforeEach(() => jest.clearAllMocks());

  it('lists reports with the parsed community and query', async () => {
    const query = Object.assign(new CommunityReportsQueryDto(), {
      page: 2,
      limit: 20,
    });
    service.listCommunityReports.mockResolvedValue({});

    await controller.list(7, query);

    expect(service.listCommunityReports).toHaveBeenCalledWith(7, query);
  });

  it('gets detail and stats for the requested community', async () => {
    service.getCommunityReportDetail.mockResolvedValue({});
    service.getModerationStats.mockResolvedValue({});

    await controller.detail(7, 12);
    await controller.stats(7);

    expect(service.getCommunityReportDetail).toHaveBeenCalledWith(7, 12);
    expect(service.getModerationStats).toHaveBeenCalledWith(7);
  });

  it.each(['list', 'detail', 'stats', 'resolve', 'dismiss'])(
    'protects %s with JWT and community role guards',
    (method) => {
      const handler = Object.getOwnPropertyDescriptor(
        CommunityReportsController.prototype,
        method,
      )?.value as ((...args: never[]) => unknown) | undefined;
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        handler as object,
      ) as unknown as unknown[];
      expect(guards).toEqual(
        expect.arrayContaining([JwtAuthGuard, CommunityRoleGuard]),
      );
    },
  );

  it('passes the authenticated moderator to resolve and dismiss', async () => {
    const request = { user: { userId: 'moderator-id' } };
    const dto = { hideContent: true };

    await controller.resolve(7, 12, dto, request as never);
    await controller.dismiss(7, 12, request as never);

    expect(service.resolveCommunityReport).toHaveBeenCalledWith(
      7,
      12,
      dto,
      'moderator-id',
    );
    expect(service.dismissCommunityReport).toHaveBeenCalledWith(
      7,
      12,
      'moderator-id',
    );
  });
});
