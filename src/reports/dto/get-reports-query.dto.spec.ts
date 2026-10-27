import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetReportsQueryDto } from './get-reports-query.dto';
import { ReportItemType } from '../enums/report-item-type.enum';
import { ReportStatus } from '../enums/report-status.enum';

describe('GetReportsQueryDto', () => {
  it('accepts valid filters and applies pagination defaults', async () => {
    const dto = plainToInstance(GetReportsQueryDto, {
      status: ReportStatus.PENDING,
      itemType: ReportItemType.PRODUCT,
      communityId: '2',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.communityId).toBe(2);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it.each([
    { status: 'open' },
    { itemType: 'user' },
    { communityId: '0' },
    { communityId: '-1' },
    { communityId: 'abc' },
    { page: '0' },
    { limit: '101' },
  ])('rejects invalid global filter %j', async (input) => {
    const dto = plainToInstance(GetReportsQueryDto, input);
    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });
});
