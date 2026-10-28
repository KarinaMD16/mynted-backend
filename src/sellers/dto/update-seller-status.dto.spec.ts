import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SellerRequestStatus } from '../../users/entities/user.entity';
import { UpdateSellerStatusDto } from './update-seller-status.dto';

describe('UpdateSellerStatusDto', () => {
  const errors = async (value: Record<string, unknown>) =>
    validate(plainToInstance(UpdateSellerStatusDto, value));

  it('requires a non-empty reason when revoking', async () => {
    await expect(
      errors({ status: SellerRequestStatus.REVOKED }),
    ).resolves.not.toEqual([]);
    await expect(
      errors({ status: SellerRequestStatus.REVOKED, reason: '   ' }),
    ).resolves.not.toEqual([]);
    await expect(
      errors({ status: SellerRequestStatus.REVOKED, reason: 'spam' }),
    ).resolves.toEqual([]);
  });

  it('accepts restore without a reason and rejects an oversized reason', async () => {
    await expect(
      errors({ status: SellerRequestStatus.APPROVED }),
    ).resolves.toEqual([]);
    await expect(
      errors({ status: SellerRequestStatus.REVOKED, reason: 'x'.repeat(501) }),
    ).resolves.not.toEqual([]);
  });
});
