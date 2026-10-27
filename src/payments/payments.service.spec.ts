/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */

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
import { SellerRequestStatus, User } from '../users/entities/user.entity';
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
    cardHolderName: 'María José Núñez',
  };

  const createHarness = (overrides: Record<string, unknown> = {}) => {
    const product = {
      id: 7,
      sellerId: 3,
      price: 120000,
      currency: 'CRC',
      type: ProductType.SALE,
      status: ProductStatus.ACTIVE,
      quantity: 1,
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
    const userRepo = { findOne: jest.fn() };
    userRepo.findOne.mockImplementation(({ where }) =>
      Promise.resolve(
        where.id === 'seller-id'
          ? {
              id: 'seller-id',
              isActive: true,
              sellerRequestStatus: SellerRequestStatus.APPROVED,
            }
          : { id: buyerId, currency: 'CRC' },
      ),
    );
    const exchangeRateService = {
      convert: jest.fn().mockResolvedValue({
        amount: 240,
        currency: 'USD',
        rate: 0.002,
        rateDate: '2026-10-19',
      }),
    };
    // Imita el UPDATE condicional del checkout sobre el producto bloqueado:
    // solo descuenta si quantity >= n y pasa a sold al llegar a 0.
    const stockUpdate = {
      calls: 0,
      params: {} as { productId?: number; quantity?: number },
    };
    const updateBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      where: jest.fn((_sql: string, params: typeof stockUpdate.params) => {
        stockUpdate.params = params;
        return updateBuilder;
      }),
      execute: jest.fn(async () => {
        stockUpdate.calls += 1;
        const wanted = stockUpdate.params.quantity ?? 1;
        if (product.quantity < wanted) return { affected: 0, raw: [] };
        product.quantity -= wanted;
        if (product.quantity === 0) product.status = ProductStatus.SOLD;
        return {
          affected: 1,
          raw: [{ quantity: product.quantity, status: product.status }],
        };
      }),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === Product) return productRepo;
        if (entity === Seller) return sellerRepo;
        if (entity === User) return userRepo;
        return txRepo;
      }),
      createQueryBuilder: jest.fn(() => updateBuilder),
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
    const eventEmitter = { emit: jest.fn() };
    const service = new PaymentsService(
      dataSource as never,
      productRepo as never,
      sellerRepo as never,
      txRepo as never,
      commissionService as never,
      paymentGateway,
      userRepo as never,
      exchangeRateService as never,
      eventEmitter as never,
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
      stockUpdate,
      updateBuilder,
      eventEmitter,
      commissionService,
      paymentGateway,
      userRepo,
      exchangeRateService,
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
      expect(JSON.stringify(body)).not.toContain('María');
    }
  });

  describe('card holder name', () => {
    it('stores and returns the normalized holder name on approval', async () => {
      const h = createHarness();

      const result = await h.service.checkout(
        {
          productId: 7,
          card: { ...card, cardHolderName: '  María   José Núñez ' },
        },
        buyerId,
        'checkout-holder-1',
      );

      expect(result).toMatchObject({
        status: TransactionStatus.COMPLETED,
        cardBrand: 'visa',
        cardLast4: '4242',
        cardHolderName: 'María José Núñez',
      });
      expect(h.txRepo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: TransactionStatus.COMPLETED,
          cardHolderName: 'María José Núñez',
        }),
      );
      expect(h.txRepo.save).not.toHaveBeenCalledWith(
        expect.objectContaining({ cardNumber: expect.anything() as unknown }),
      );
      expect(h.txRepo.save).not.toHaveBeenCalledWith(
        expect.objectContaining({ cvv: expect.anything() as unknown }),
      );
    });

    it('does not store the holder name when the payment is rejected', async () => {
      const h = createHarness();
      h.paymentGateway.charge.mockResolvedValue({
        approved: false,
        failureReason: 'card_declined',
      });

      await expect(
        h.service.checkout(dto(), buyerId, 'checkout-holder-2'),
      ).rejects.toBeInstanceOf(HttpException);
      expect(h.txRepo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: TransactionStatus.FAILED,
          cardBrand: null,
          cardLast4: null,
          cardHolderName: null,
        }),
      );
    });

    it('replays the same idempotency key with the stored holder name', async () => {
      const h = createHarness();
      h.txRepo.findOne.mockResolvedValue({
        id: 'existing',
        productId: 7,
        buyerId,
        status: TransactionStatus.COMPLETED,
        cardBrand: 'visa',
        cardLast4: '4242',
        cardHolderName: 'María José Núñez',
      });

      // La idempotencia compara comprador y producto, no el cuerpo: un
      // reintento devuelve la transacción guardada tal cual.
      await expect(
        h.service.checkout(
          { productId: 7, card: { ...card, cardHolderName: 'Otro Nombre' } },
          buyerId,
          'checkout-holder-3',
        ),
      ).resolves.toMatchObject({
        id: 'existing',
        cardHolderName: 'María José Núñez',
      });
      expect(h.paymentGateway.charge).not.toHaveBeenCalled();
    });

    it('returns null for transactions created before the field existed', async () => {
      const h = createHarness();
      h.txRepo.findOne.mockResolvedValue({
        id: 'legacy',
        productId: 7,
        buyerId,
        status: TransactionStatus.COMPLETED,
        cardBrand: 'visa',
        cardLast4: '4242',
        cardHolderName: null,
      });

      await expect(
        h.service.checkout(dto(), buyerId, 'checkout-holder-4'),
      ).resolves.toMatchObject({ id: 'legacy', cardHolderName: null });
    });
  });

  describe('quote', () => {
    it('returns a CRC quote for a buyer without commission internals', async () => {
      const h = createHarness();

      const result = await h.service.quote(7, buyerId);

      expect(result).toEqual({
        productId: 7,
        quantity: 1,
        unitPrice: 120000,
        availableQuantity: 1,
        amount: 120000,
        currency: 'CRC',
      });
      expect(result).not.toHaveProperty('commission');
      expect(h.exchangeRateService.convert).not.toHaveBeenCalled();
      expect(h.paymentGateway.charge).not.toHaveBeenCalled();
      expect(h.txRepo.create).not.toHaveBeenCalled();
      expect(h.product.status).toBe(ProductStatus.ACTIVE);
      expect(h.seller.completedSalesCount).toBe(9);
    });

    it('returns a USD quote without converting when buyer currency is USD', async () => {
      const h = createHarness({ product: { currency: 'USD' } });
      h.userRepo.findOne.mockResolvedValue({ id: buyerId, currency: 'USD' });

      await expect(h.service.quote(7, buyerId)).resolves.toMatchObject({
        productId: 7,
        amount: 120000,
        currency: 'USD',
      });
      expect(h.exchangeRateService.convert).not.toHaveBeenCalled();
    });

    it('exposes commission only to the product owner', async () => {
      const h = createHarness({ seller: { userId: buyerId } });

      await expect(h.service.quote(7, buyerId)).resolves.toMatchObject({
        productId: 7,
        commission: {
          rate: 0.03,
          amount: 3600,
          sellerNet: 116400,
          salesTierName: 'Bronce',
          priceTierName: 'Alto',
          salesDiscount: 0,
          priceDiscount: 0.01,
        },
      });
      expect(h.commissionService.calculate).toHaveBeenCalledWith(
        120000,
        'CRC',
        9,
      );
    });

    it('converts only for display when user currency differs', async () => {
      const h = createHarness();
      h.userRepo.findOne.mockResolvedValue({ id: buyerId, currency: 'USD' });

      const result = await h.service.quote(7, buyerId);

      expect(result).toMatchObject({
        amount: 120000,
        currency: 'CRC',
        convertedAmount: {
          amount: 240,
          currency: 'USD',
          exchangeRate: 0.002,
          rateDate: '2026-10-19',
        },
      });
      expect(h.exchangeRateService.convert).toHaveBeenCalledWith(
        120000,
        'CRC',
        'USD',
      );
      expect(result.amount).toBe(120000);
    });

    it('omits display conversion when user currency is absent', async () => {
      const h = createHarness();
      h.userRepo.findOne.mockResolvedValue({ id: buyerId, currency: null });

      await expect(h.service.quote(7, buyerId)).resolves.toEqual({
        productId: 7,
        quantity: 1,
        unitPrice: 120000,
        availableQuantity: 1,
        amount: 120000,
        currency: 'CRC',
      });
      expect(h.exchangeRateService.convert).not.toHaveBeenCalled();
    });

    it.each([
      ['missing product', null, NotFoundException],
      ['sold product', { status: ProductStatus.SOLD }, ConflictException],
      [
        'inactive product',
        { status: ProductStatus.INACTIVE },
        ConflictException,
      ],
      ['exchange product', { type: ProductType.EXCHANGE }, BadRequestException],
      ['null price', { price: null }, BadRequestException],
      ['zero price', { price: 0 }, BadRequestException],
      ['empty currency', { currency: ' ' }, BadRequestException],
    ])('rejects %s', async (_name, productOverride, exception) => {
      const h = createHarness();
      if (productOverride === null) {
        h.productRepo.findOne.mockResolvedValue(null);
      } else {
        Object.assign(h.product, productOverride);
      }

      await expect(h.service.quote(7, buyerId)).rejects.toBeInstanceOf(
        exception,
      );
      expect(h.paymentGateway.charge).not.toHaveBeenCalled();
      expect(h.txRepo.create).not.toHaveBeenCalled();
    });

    it('propagates exchange-rate unavailability for display conversion', async () => {
      const h = createHarness();
      h.userRepo.findOne.mockResolvedValue({ id: buyerId, currency: 'USD' });
      h.exchangeRateService.convert.mockRejectedValue(
        new ServiceUnavailableException('rate unavailable'),
      );

      await expect(h.service.quote(7, buyerId)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });
  describe('quantity (stock)', () => {
    const completed = (h: ReturnType<typeof createHarness>) =>
      h.eventEmitter.emit.mock.calls.find(
        ([name]: [string]) => name === 'payment.checkout.completed',
      )?.[1];

    it('buys 1 unit with stock 3: leaves 2, stays active and does not announce sold out', async () => {
      const h = createHarness({ product: { quantity: 3 } });

      const result = await h.service.checkout(dto(), buyerId, 'stock-key-1');

      expect(result).toMatchObject({
        status: TransactionStatus.COMPLETED,
        quantity: 1,
        unitPrice: 120000,
        amount: 120000,
      });
      expect(h.product.quantity).toBe(2);
      expect(h.product.status).toBe(ProductStatus.ACTIVE);
      expect(completed(h)).toMatchObject({ quantity: 1, soldOut: false });
    });

    it('charges unit price x quantity and uses it for the commission', async () => {
      const h = createHarness({ product: { quantity: 5 } });

      const result = await h.service.checkout(
        { ...dto(), quantity: 3 },
        buyerId,
        'stock-key-2',
      );

      expect(result).toMatchObject({
        quantity: 3,
        unitPrice: 120000,
        amount: 360000,
      });
      expect(h.commissionService.calculate).toHaveBeenCalledWith(
        360000,
        'CRC',
        9,
      );
      expect(h.paymentGateway.charge).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 360000 }),
      );
      expect(h.product.quantity).toBe(2);
      // Una compra suma una venta completada, sin importar las unidades.
      expect(h.seller.completedSalesCount).toBe(10);
    });

    it('moves the product to sold when the purchase takes the last units', async () => {
      const h = createHarness({ product: { quantity: 3 } });

      await h.service.checkout(
        { ...dto(), quantity: 3 },
        buyerId,
        'stock-key-3',
      );

      expect(h.product.quantity).toBe(0);
      expect(h.product.status).toBe(ProductStatus.SOLD);
      expect(completed(h)).toMatchObject({ quantity: 3, soldOut: true });
    });

    it('conditionally updates stock inside the same transaction', async () => {
      const h = createHarness({ product: { quantity: 3 } });

      await h.service.checkout(
        { ...dto(), quantity: 2 },
        buyerId,
        'stock-key-4',
      );

      expect(h.manager.createQueryBuilder).toHaveBeenCalled();
      expect(h.updateBuilder.where).toHaveBeenCalledWith(
        expect.stringContaining('quantity >= :quantity'),
        { productId: 7, quantity: 2 },
      );
    });

    it('rejects buying more than the available stock without charging', async () => {
      const h = createHarness({ product: { quantity: 3 } });

      await expect(
        h.service.checkout({ ...dto(), quantity: 4 }, buyerId, 'stock-key-5'),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(h.paymentGateway.charge).not.toHaveBeenCalled();
      expect(h.txRepo.save).not.toHaveBeenCalled();
      expect(h.stockUpdate.calls).toBe(0);
      expect(h.product.quantity).toBe(3);
    });

    it('rejects an out-of-stock product', async () => {
      const h = createHarness({ product: { quantity: 0 } });

      await expect(
        h.service.checkout(dto(), buyerId, 'stock-key-6'),
      ).rejects.toThrow('agotado');
      expect(h.paymentGateway.charge).not.toHaveBeenCalled();
    });

    it('leaves the stock untouched when the payment is declined', async () => {
      const h = createHarness({ product: { quantity: 3 } });
      h.paymentGateway.charge.mockResolvedValue({
        approved: false,
        failureReason: 'card_declined',
      });

      await expect(
        h.service.checkout({ ...dto(), quantity: 2 }, buyerId, 'stock-key-7'),
      ).rejects.toBeInstanceOf(HttpException);

      expect(h.stockUpdate.calls).toBe(0);
      expect(h.product.quantity).toBe(3);
      expect(h.product.status).toBe(ProductStatus.ACTIVE);
      expect(h.eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('lets only one of two concurrent purchases of the last unit pass', async () => {
      const h = createHarness({ product: { quantity: 1 } });
      // Ambos ven el stock "viejo" (1): el UPDATE condicional decide.
      h.productRepo.findOne.mockImplementation(async () => ({ ...h.product }));

      const results = await Promise.allSettled([
        h.service.checkout(dto(), 'buyer-a', 'concurrent-key-a'),
        h.service.checkout(dto(), 'buyer-b', 'concurrent-key-b'),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(h.product.quantity).toBe(0);
      expect(
        h.eventEmitter.emit.mock.calls.filter(
          ([name]: [string]) => name === 'payment.checkout.completed',
        ),
      ).toHaveLength(1);
    });

    it('treats the same idempotency key with another quantity as another operation', async () => {
      const h = createHarness({ product: { quantity: 5 } });
      h.txRepo.findOne.mockResolvedValue({
        id: 'existing',
        buyerId,
        productId: 7,
        quantity: 1,
        status: TransactionStatus.COMPLETED,
      });

      await expect(
        h.service.checkout({ ...dto(), quantity: 2 }, buyerId, 'same-key-1'),
      ).rejects.toThrow('clave de idempotencia');
    });

    it('quotes the total for several units and caps it by the stock', async () => {
      const h = createHarness({ product: { quantity: 3 } });

      await expect(h.service.quote(7, buyerId, 2)).resolves.toMatchObject({
        quantity: 2,
        unitPrice: 120000,
        availableQuantity: 3,
        amount: 240000,
      });
      await expect(h.service.quote(7, buyerId, 4)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
  describe('discount (final price)', () => {
    it('charges and commissions the price without discount when there is none', async () => {
      const h = createHarness({ product: { discountPercent: null } });

      const result = await h.service.checkout(dto(), buyerId, 'discount-key-0');

      expect(result).toMatchObject({ unitPrice: 120000, amount: 120000 });
      expect(h.commissionService.calculate).toHaveBeenCalledWith(
        120000,
        'CRC',
        9,
      );
      expect(h.paymentGateway.charge).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 120000 }),
      );
    });

    it('uses the final price as unit price for a discounted product', async () => {
      const h = createHarness({ product: { discountPercent: 20 } });

      const result = await h.service.checkout(dto(), buyerId, 'discount-key-1');

      expect(result).toMatchObject({ unitPrice: 96000, amount: 96000 });
      expect(h.commissionService.calculate).toHaveBeenCalledWith(
        96000,
        'CRC',
        9,
      );
      expect(h.paymentGateway.charge).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 96000 }),
      );
      expect(h.txRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ unitPrice: 96000, amount: 96000 }),
      );
    });

    it('multiplies the discounted unit price by the quantity', async () => {
      const h = createHarness({
        product: { discountPercent: 20, quantity: 5 },
      });

      const result = await h.service.checkout(
        { ...dto(), quantity: 3 },
        buyerId,
        'discount-key-2',
      );

      expect(result).toMatchObject({
        quantity: 3,
        unitPrice: 96000,
        amount: 288000,
      });
      expect(h.commissionService.calculate).toHaveBeenCalledWith(
        288000,
        'CRC',
        9,
      );
      expect(h.paymentGateway.charge).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 288000 }),
      );
    });

    it('rounds the discounted unit price to 2 decimals before multiplying', async () => {
      const h = createHarness({
        product: {
          price: 10,
          currency: 'USD',
          discountPercent: 33.33,
          quantity: 3,
        },
      });

      const result = await h.service.checkout(
        { ...dto(), quantity: 3 },
        buyerId,
        'discount-key-3',
      );

      // 10 * (1 - 0.3333) = 6.667 -> 6.67 por unidad; 3 unidades = 20.01
      expect(result).toMatchObject({ unitPrice: 6.67, amount: 20.01 });
    });

    it('rejects a product whose final price is 0 (100% discount)', async () => {
      const h = createHarness({ product: { discountPercent: 100 } });

      await expect(
        h.service.checkout(dto(), buyerId, 'discount-key-4'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(h.paymentGateway.charge).not.toHaveBeenCalled();
    });

    it('quotes the discounted unit price and total', async () => {
      const h = createHarness({
        product: { discountPercent: 20, quantity: 5 },
      });

      await expect(h.service.quote(7, buyerId)).resolves.toMatchObject({
        quantity: 1,
        unitPrice: 96000,
        amount: 96000,
      });
      await expect(h.service.quote(7, buyerId, 2)).resolves.toMatchObject({
        quantity: 2,
        unitPrice: 96000,
        amount: 192000,
      });
      expect(h.commissionService.calculate).toHaveBeenLastCalledWith(
        192000,
        'CRC',
        9,
      );
    });

    it('quotes the full price when the product has no discount', async () => {
      const h = createHarness({ product: { discountPercent: null } });

      await expect(h.service.quote(7, buyerId)).resolves.toMatchObject({
        unitPrice: 120000,
        amount: 120000,
      });
    });
  });
});
