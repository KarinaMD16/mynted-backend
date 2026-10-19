/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */

import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Product,
  ProductStatus,
  ProductType,
} from '../products/entities/product.entity';
import { Seller } from '../sellers/entities/seller.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { TransactionStatus } from './enums/transaction-status.enum';
import {
  PaymentCardValidationCode,
  PaymentCardValidationError,
} from './gateway/card-validation';
import { CheckoutDto } from './dto/checkout.dto';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  const buyerId = 'buyer-id';
  const card = {
    cardNumber: '4242424242424242',
    expiryMonth: 12,
    expiryYear: 2099,
    cvv: '123',
  };

  const createHarness = (overrides: Record<string, unknown> = {}) => {
    const product = {
      id: 7,
      sellerId: 3,
      price: 120000,
      currency: 'CRC',
      type: ProductType.SALE,
      status: ProductStatus.ACTIVE,
      ...(overrides.product as object | undefined),
    } as Product;
    const seller = {
      sellerId: 3,
      userId: 'seller-id',
      completedSalesCount: 9,
      ...(overrides.seller as object | undefined),
    } as Seller;
    const txRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => ({ id: 'tx-1', ...value })),
      save: jest.fn(async (value) => value),
    };
    const productRepo = {
      findOne: jest.fn().mockResolvedValue(product),
      save: jest.fn(async (value) => value),
    };
    const sellerRepo = {
      findOne: jest.fn().mockResolvedValue(seller),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === Product) return productRepo;
        if (entity === Seller) return sellerRepo;
        return txRepo;
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const commissionService = {
      calculate: jest.fn().mockResolvedValue({
        rate: 0.03,
        salesTier: 'Bronce',
        priceTier: 'Alto',
        salesDiscount: 0,
        priceDiscount: 0.01,
        commissionAmount: 3600,
        sellerNet: 116400,
        exchangeRate: null,
        normalizedAmountCrc: null,
      }),
    };
    const paymentGateway = {
      charge: jest.fn().mockResolvedValue({
        approved: true,
        gatewayReference: 'SIM-A1B2C3',
        cardBrand: 'visa',
        cardLast4: '4242',
      }),
    };
    const service = new PaymentsService(
      dataSource as never,
      productRepo as never,
      sellerRepo as never,
      txRepo as never,
      commissionService as never,
      paymentGateway,
    );
    return {
      service,
      product,
      seller,
      txRepo,
      productRepo,
      sellerRepo,
      dataSource,
      manager,
      commissionService,
      paymentGateway,
    };
  };

  const dto = (productId = 7): CheckoutDto => ({
    productId,
    card,
  });

  it('creates pending before charging and atomically completes the sale', async () => {
    const h = createHarness();
    h.paymentGateway.charge.mockImplementation(async () => {
      expect(h.txRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: TransactionStatus.PENDING }),
      );
      return {
        approved: true,
        gatewayReference: 'SIM-A1B2C3',
        cardBrand: 'visa',
        cardLast4: '4242',
      };
    });

    const result = await h.service.checkout(dto(), buyerId, 'checkout-1');

    expect(result).toMatchObject({
      id: 'tx-1',
      status: TransactionStatus.COMPLETED,
      amount: 120000,
      currency: 'CRC',
      gatewayReference: 'SIM-A1B2C3',
      cardLast4: '4242',
    });
    expect(h.commissionService.calculate).toHaveBeenCalledWith(
      120000,
      'CRC',
      9,
    );
    expect(h.paymentGateway.charge).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 120000, currency: 'CRC', card }),
    );
    expect(h.product.status).toBe(ProductStatus.SOLD);
    expect(h.seller.completedSalesCount).toBe(10);
    expect(result.completedAt).not.toBeNull();
    expect(result.commission).toEqual({
      salesTierName: 'Bronce',
      salesDiscount: 0,
      priceTierName: 'Alto',
      priceDiscount: 0.01,
      commissionRate: 0.03,
      commissionAmount: 3600,
      sellerNet: 116400,
      exchangeRate: null,
      normalizedAmountCrc: null,
    });
  });

  it('persists a rejected payment and maps it to HTTP 402 after commit', async () => {
    const h = createHarness();
    h.paymentGateway.charge.mockResolvedValue({
      approved: false,
      failureReason: 'card_declined',
    });

    const promise = h.service.checkout(dto(), buyerId, 'checkout-2');

    await expect(promise).rejects.toBeInstanceOf(HttpException);
    await expect(promise).rejects.toMatchObject({
      status: 402,
      response: expect.objectContaining({
        transactionId: 'tx-1',
        failureReason: 'card_declined',
      }),
    });
    expect(h.txRepo.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: TransactionStatus.FAILED,
        completedAt: null,
      }),
    );
    expect(h.product.status).toBe(ProductStatus.ACTIVE);
    expect(h.seller.completedSalesCount).toBe(9);
  });

  it('uses both pessimistic locks through the transaction manager', async () => {
    const h = createHarness();

    await h.service.checkout(dto(), buyerId, 'checkout-3');

    expect(h.productRepo.findOne).toHaveBeenCalledWith({
      where: { id: 7 },
      lock: { mode: 'pessimistic_write' },
    });
    expect(h.sellerRepo.findOne).toHaveBeenCalledWith({
      where: { sellerId: 3 },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('replays completed idempotency without calling commission or gateway', async () => {
    const h = createHarness();
    const existing = {
      id: 'existing',
      productId: 7,
      buyerId,
      amount: 120000,
      currency: 'CRC',
      status: TransactionStatus.COMPLETED,
      salesTierName: 'Bronce',
      salesDiscount: 0,
      priceTierName: 'Alto',
      priceDiscount: 0.01,
      commissionRate: 0.03,
      commissionAmount: 3600,
      sellerNet: 116400,
      exchangeRate: null,
      normalizedAmountCrc: null,
      gatewayReference: 'SIM-A1B2C3',
      cardBrand: 'visa',
      cardLast4: '4242',
      failureReason: null,
      completedAt: new Date(),
    } as PaymentTransaction;
    h.txRepo.findOne.mockResolvedValue(existing);

    await expect(
      h.service.checkout(dto(), buyerId, 'checkout-4'),
    ).resolves.toMatchObject({
      id: 'existing',
      status: TransactionStatus.COMPLETED,
    });
    expect(h.dataSource.transaction).not.toHaveBeenCalled();
    expect(h.paymentGateway.charge).not.toHaveBeenCalled();
    expect(h.commissionService.calculate).not.toHaveBeenCalled();
  });

  it('rejects a reused key for another buyer or product', async () => {
    const h = createHarness();
    h.txRepo.findOne.mockResolvedValue({
      productId: 99,
      buyerId: 'other-buyer',
      status: TransactionStatus.COMPLETED,
    });

    await expect(
      h.service.checkout(dto(), buyerId, 'checkout-5'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('does not charge when commission calculation fails', async () => {
    const h = createHarness();
    h.commissionService.calculate.mockRejectedValue(
      new ServiceUnavailableException('BCCR unavailable'),
    );

    await expect(
      h.service.checkout(dto(), buyerId, 'checkout-6'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(h.paymentGateway.charge).not.toHaveBeenCalled();
  });

  it('rolls back logically on invalid card and does not change product or seller', async () => {
    const h = createHarness();
    h.paymentGateway.charge.mockRejectedValue(
      new PaymentCardValidationError(
        PaymentCardValidationCode.INVALID_CARD_NUMBER,
      ),
    );

    await expect(
      h.service.checkout(dto(), buyerId, 'checkout-7'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.product.status).toBe(ProductStatus.ACTIVE);
    expect(h.seller.completedSalesCount).toBe(9);
  });

  it('recovers a concurrent unique-key winner after transaction rollback', async () => {
    const h = createHarness();
    const existing = {
      id: 'winner',
      productId: 7,
      buyerId,
      amount: 120000,
      currency: 'CRC',
      status: TransactionStatus.COMPLETED,
      salesTierName: 'Bronce',
      salesDiscount: 0,
      priceTierName: 'Alto',
      priceDiscount: 0.01,
      commissionRate: 0.03,
      commissionAmount: 3600,
      sellerNet: 116400,
      exchangeRate: null,
      normalizedAmountCrc: null,
      gatewayReference: 'SIM-A1B2C3',
      cardBrand: 'visa',
      cardLast4: '4242',
      failureReason: null,
      completedAt: new Date(),
    } as PaymentTransaction;
    h.dataSource.transaction.mockRejectedValue({
      code: '23505',
      constraint: 'UQ_payment_transaction_idempotency_key',
    });
    h.txRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);

    await expect(
      h.service.checkout(dto(), buyerId, 'checkout-8'),
    ).resolves.toMatchObject({
      id: 'winner',
    });
    expect(h.paymentGateway.charge).not.toHaveBeenCalled();
  });

  it.each([
    ['product does not exist', { product: undefined }, NotFoundException],
    [
      'sold product',
      { product: { status: ProductStatus.SOLD } },
      ConflictException,
    ],
    [
      'inactive product',
      { product: { status: ProductStatus.INACTIVE } },
      ConflictException,
    ],
    [
      'exchange product',
      { product: { type: ProductType.EXCHANGE } },
      BadRequestException,
    ],
    ['own product', { seller: { userId: buyerId } }, BadRequestException],
    ['null price', { product: { price: null } }, BadRequestException],
    ['zero price', { product: { price: 0 } }, BadRequestException],
    ['negative price', { product: { price: -1 } }, BadRequestException],
    ['null currency', { product: { currency: null } }, BadRequestException],
    ['empty currency', { product: { currency: '  ' } }, BadRequestException],
  ])('%s is rejected before charging', async (_name, override, exception) => {
    const h = createHarness(override);
    if (_name === 'product does not exist') {
      h.productRepo.findOne.mockResolvedValue(null);
    }

    await expect(
      h.service.checkout(dto(), buyerId, 'checkout-validation'),
    ).rejects.toBeInstanceOf(exception);
    expect(h.paymentGateway.charge).not.toHaveBeenCalled();
  });

  it('passes count 10 to commission and increments seller to 11', async () => {
    const h = createHarness({ seller: { completedSalesCount: 10 } });

    await h.service.checkout(dto(), buyerId, 'checkout-count-10');

    expect(h.commissionService.calculate).toHaveBeenCalledWith(
      120000,
      'CRC',
      10,
    );
    expect(h.seller.completedSalesCount).toBe(11);
  });

  it.each([
    ['failed', TransactionStatus.FAILED, 402],
    ['pending', TransactionStatus.PENDING, 409],
    ['refunded', TransactionStatus.REFUNDED, 409],
  ])(
    'replays existing %s according to its status',
    async (_name, status, httpStatus) => {
      const h = createHarness();
      h.txRepo.findOne.mockResolvedValue({
        id: 'existing',
        productId: 7,
        buyerId,
        status,
        failureReason:
          status === TransactionStatus.FAILED ? 'card_declined' : null,
      });

      await expect(
        h.service.checkout(dto(), buyerId, 'checkout-existing'),
      ).rejects.toMatchObject({
        status: httpStatus,
      });
      expect(h.paymentGateway.charge).not.toHaveBeenCalled();
    },
  );

  it('does not recover an unrelated PostgreSQL unique violation as idempotency', async () => {
    const h = createHarness();
    h.dataSource.transaction.mockRejectedValue({
      code: '23505',
      constraint: 'UQ_other_constraint',
    });

    await expect(
      h.service.checkout(dto(), buyerId, 'checkout-other-unique'),
    ).rejects.toMatchObject({
      status: 500,
    });
    expect(h.txRepo.findOne).toHaveBeenCalledTimes(1);
    expect(h.paymentGateway.charge).not.toHaveBeenCalled();
  });

  it('maps an unexpected gateway error to safe 503 without card data', async () => {
    const h = createHarness();
    h.paymentGateway.charge.mockRejectedValue(
      new Error('PAN 4242424242424242 CVV 123 leaked internally'),
    );

    try {
      await h.service.checkout(dto(), buyerId, 'checkout-gateway-error');
      throw new Error('expected checkout to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const response = (error as ServiceUnavailableException).getResponse();
      expect(JSON.stringify(response)).not.toContain('4242424242424242');
      expect(JSON.stringify(response)).not.toContain('123');
    }
    expect(h.product.status).toBe(ProductStatus.ACTIVE);
    expect(h.seller.completedSalesCount).toBe(9);
  });

  it('keeps failed HTTP 402 response sanitized', async () => {
    const h = createHarness();
    h.paymentGateway.charge.mockResolvedValue({
      approved: false,
      failureReason: 'card_declined',
    });

    try {
      await h.service.checkout(dto(), buyerId, 'checkout-safe-402');
      throw new Error('expected checkout to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const body = (error as HttpException).getResponse();
      expect(body).toEqual({
        statusCode: 402,
        transactionId: 'tx-1',
        failureReason: 'card_declined',
      });
      expect(JSON.stringify(body)).not.toContain('cardNumber');
      expect(JSON.stringify(body)).not.toContain('cvv');
    }
  });
});
