import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SalesSummaryQueryDto } from './sales-summary-query.dto';

describe('SalesSummaryQueryDto', () => {
  it.each(['2026-01-01', '2026-10-19', '2026-12-31'])(
    'accepts valid date %s',
    async (date) => {
      const dto = plainToInstance(SalesSummaryQueryDto, {
        from: date,
        to: date,
      });
      await expect(validate(dto)).resolves.toHaveLength(0);
    },
  );

  it.each(['01-01-2026', '2026/01/01', '2026-1-1', 'abc'])(
    'rejects invalid date format %s',
    async (date) => {
      const dto = plainToInstance(SalesSummaryQueryDto, { from: date });
      await expect(validate(dto)).resolves.not.toHaveLength(0);
    },
  );

  it('publishes an OpenAPI regex that accepts YYYY-MM-DD', () => {
    const metadata = Reflect.getMetadata(
      'swagger/apiModelProperties',
      SalesSummaryQueryDto.prototype,
      'from',
    ) as { pattern?: string };

    expect(metadata.pattern).toBe('^\\d{4}-\\d{2}-\\d{2}$');
    expect(new RegExp(metadata.pattern!).test('2026-01-01')).toBe(true);
  });
});
