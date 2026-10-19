import { ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, PIPES_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SellerGuard } from '../auth/guards/seller.guard';
import { CommissionEstimateQueryDto } from './dto/commission-estimate-query.dto';
import { SellerCommissionController } from './seller-commission.controller';

describe('SellerCommissionController', () => {
  it('uses JwtAuthGuard and SellerGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      SellerCommissionController.prototype.estimate,
    ) as unknown[];

    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, SellerGuard]));
  });

  it('passes authenticated userId and numeric amount to the service', async () => {
    const estimateCommission = jest.fn().mockResolvedValue({
      amount: 120000,
      currency: 'CRC',
      commissionRate: 0.03,
      commissionAmount: 3600,
      sellerNet: 116400,
    });
    const controller = new SellerCommissionController({
      estimateCommission,
    } as never);
    const query: CommissionEstimateQueryDto = { amount: 120000 };

    await expect(
      controller.estimate(query, { user: { userId: 'seller-user' } } as never),
    ).resolves.toMatchObject({ amount: 120000 });
    expect(estimateCommission).toHaveBeenCalledWith('seller-user', 120000);
  });

  it('has a local transforming validation pipe', () => {
    const pipes = Reflect.getMetadata(
      PIPES_METADATA,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      SellerCommissionController.prototype.estimate,
    ) as ValidationPipe[] | undefined;

    expect(pipes?.length).toBeGreaterThan(0);
  });
});
