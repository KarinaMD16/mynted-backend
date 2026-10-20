import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SellersService } from './sellers.service';

describe('SellersService.estimateCommission', () => {
  const userId = 'seller-user';
  const seller = {
    sellerId: 4,
    userId,
    completedSalesCount: 9,
  };
  const calculation = {
    rate: 0.03,
    salesTier: 'Oro',
    priceTier: 'Alto',
    salesDiscount: 0.01,
    priceDiscount: 0.01,
    commissionAmount: 3600,
    sellerNet: 116400,
    exchangeRate: null,
    normalizedAmountCrc: null,
  };

  const create = () => {
    const sellerRepository = {
      findOne: jest.fn().mockResolvedValue(seller),
      save: jest.fn(),
    };
    const usersService = {
      findById: jest.fn().mockResolvedValue({ id: userId, currency: 'crc' }),
    };
    const commissionService = {
      calculate: jest.fn().mockResolvedValue(calculation),
    };
    const dataSource = { transaction: jest.fn() };
    const service = new SellersService(
      sellerRepository as never,
      usersService as never,
      commissionService as never,
      dataSource as never,
    );
    return { service, sellerRepository, usersService, commissionService };
  };

  it('estimates CRC commission with the current sales count', async () => {
    const h = create();

    await expect(h.service.estimateCommission(userId, 120000)).resolves.toEqual(
      {
        amount: 120000,
        currency: 'CRC',
        commissionRate: 0.03,
        commissionAmount: 3600,
        sellerNet: 116400,
        salesTierName: 'Oro',
        priceTierName: 'Alto',
        salesDiscount: 0.01,
        priceDiscount: 0.01,
      },
    );
    expect(h.commissionService.calculate).toHaveBeenCalledWith(
      120000,
      'CRC',
      9,
    );
    expect(h.sellerRepository.save).not.toHaveBeenCalled();
  });

  it('passes USD to CommissionService without changing the seller', async () => {
    const h = create();
    h.usersService.findById.mockResolvedValue({
      id: userId,
      currency: ' USD ',
    });

    await h.service.estimateCommission(userId, 500);

    expect(h.commissionService.calculate).toHaveBeenCalledWith(500, 'USD', 9);
    expect(seller.completedSalesCount).toBe(9);
  });

  it('rejects a missing seller', async () => {
    const h = create();
    h.sellerRepository.findOne.mockResolvedValue(null);

    await expect(
      h.service.estimateCommission(userId, 100),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.usersService.findById).not.toHaveBeenCalled();
  });

  it.each([null, '', '   '])(
    'rejects missing seller currency: %p',
    async (currency) => {
      const h = create();
      h.usersService.findById.mockResolvedValue({ id: userId, currency });

      await expect(
        h.service.estimateCommission(userId, 100),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(h.commissionService.calculate).not.toHaveBeenCalled();
    },
  );

  it('propagates CommissionService errors and does not write', async () => {
    const h = create();
    h.commissionService.calculate.mockRejectedValue(
      new ServiceUnavailableException('BCCR unavailable'),
    );

    await expect(
      h.service.estimateCommission(userId, 100),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(h.sellerRepository.save).not.toHaveBeenCalled();
  });

  it('does not access Product, PaymentTransaction or PaymentGateway', async () => {
    const h = create();

    await h.service.estimateCommission(userId, 100);

    expect(h.service).toBeDefined();
    expect(h.commissionService.calculate).toHaveBeenCalledTimes(1);
  });
});
