import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CommunityReportsQueryDto } from './community-reports-query.dto';
import { ReportStatus } from '../enums/report-status.enum';

describe('CommunityReportsQueryDto', () => {
  it('uses the requested pagination defaults', async () => {
    const dto = plainToInstance(CommunityReportsQueryDto, {});

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('accepts real report statuses and rejects unknown values', async () => {
    const valid = plainToInstance(CommunityReportsQueryDto, {
      status: ReportStatus.PENDING,
    });
    const invalid = plainToInstance(CommunityReportsQueryDto, {
      status: 'open',
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    await expect(validate(invalid)).resolves.toHaveLength(1);
  });
});
