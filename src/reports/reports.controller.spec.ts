import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportItemType } from './enums/report-item-type.enum';
import { ReportReason } from './enums/report-reason.enum';

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
});
