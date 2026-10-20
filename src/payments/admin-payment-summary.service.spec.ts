import { BadRequestException } from '@nestjs/common';
import { AdminPaymentSummaryService } from './admin-payment-summary.service';

describe('AdminPaymentSummaryService', () => {
  const create = () => {
    const queryBuilder = {
      clone: jest.fn(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawMany: jest
        .fn()
        .mockResolvedValueOnce([
          {
            currency: 'CRC',
            transactionCount: '2',
            gross: '100',
            commissions: '4',
            sellerNet: '96',
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    };
    queryBuilder.clone.mockReturnValue(queryBuilder);
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    return {
      service: new AdminPaymentSummaryService(repository as never),
      queryBuilder,
    };
  };

  it('groups only completed transactions without currency conversion', async () => {
    const h = create();
    const result = await h.service.summary({
      from: '2026-01-01',
      to: '2026-01-31',
    });
    expect(result.totalsByCurrency).toEqual([
      expect.objectContaining({
        currency: 'CRC',
        transactionCount: 2,
        commissions: 4,
      }),
    ]);
    expect(h.queryBuilder.where).toHaveBeenCalledWith(
      'transaction.status = :status',
      { status: 'completed' },
    );
    expect(h.queryBuilder.groupBy).toHaveBeenCalled();
  });

  it('rejects an inverted period', async () => {
    const h = create();
    await expect(
      h.service.summary({ from: '2026-02-01', to: '2026-01-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.queryBuilder.getRawMany).not.toHaveBeenCalled();
  });
});
