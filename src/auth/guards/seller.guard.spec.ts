import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { SellerGuard } from './seller.guard';
import {
  SellerRequestStatus,
  UserRole,
} from '../../users/entities/user.entity';

describe('SellerGuard', () => {
  const context = (userId = 'seller-user') =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: { userId } }) }),
    }) as unknown as ExecutionContext;

  it('allows only a seller with approved seller status', async () => {
    const usersService = {
      findById: jest.fn().mockResolvedValue({
        role: UserRole.SELLER,
        sellerRequestStatus: SellerRequestStatus.APPROVED,
      }),
    };
    const guard = new SellerGuard(usersService as never);

    await expect(guard.canActivate(context())).resolves.toBe(true);
  });

  it.each([
    [UserRole.USER, SellerRequestStatus.REVOKED],
    [UserRole.SELLER, SellerRequestStatus.REVOKED],
    [UserRole.SELLER, SellerRequestStatus.PENDING],
  ])('rejects role/status pair %s/%s', async (role, sellerRequestStatus) => {
    const usersService = {
      findById: jest.fn().mockResolvedValue({ role, sellerRequestStatus }),
    };
    const guard = new SellerGuard(usersService as never);

    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
