/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */

import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Repository } from 'typeorm';
import { PriceDisplayService } from '../pricing/price-display.service';
import { UsersService } from '../users/users.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product, ProductStatus, ProductType } from './entities/product.entity';
import { isProductAvailable, unavailableReason } from './product-pricing';
import { ProductsService } from './products.service';
import { ReviewsService } from './reviews.service';

describe('Product quantity (stock)', () => {
  describe('DTO validation', () => {
    const validateCreate = (quantity?: unknown) =>
      validate(
        plainToInstance(CreateProductDto, {
          title: 'Funko',
          ...(quantity === undefined ? {} : { quantity }),
        }),
      );
    const validateUpdate = (quantity: unknown) =>
      validate(plainToInstance(UpdateProductDto, { quantity }));

    it('create: quantity is optional', async () => {
      expect(await validateCreate()).toHaveLength(0);
    });

    it('create: accepts 1..9999 (also as multipart text)', async () => {
      expect(await validateCreate(1)).toHaveLength(0);
      expect(await validateCreate('3')).toHaveLength(0);
      expect(await validateCreate(9999)).toHaveLength(0);
    });

    it.each([0, -1, 1.5, 10000, 'abc'])(
      'create: rejects quantity %p',
      async (quantity) => {
        const errors = await validateCreate(quantity);
        expect(errors.map((e) => e.property)).toContain('quantity');
      },
    );

    it('update: accepts 0 (sold out) but not negatives or decimals', async () => {
      expect(await validateUpdate(0)).toHaveLength(0);
      expect(await validateUpdate(5)).toHaveLength(0);
      expect((await validateUpdate(-1)).map((e) => e.property)).toContain(
        'quantity',
      );
      expect((await validateUpdate(2.5)).map((e) => e.property)).toContain(
        'quantity',
      );
    });
  });

  describe('availability helpers', () => {
    const base = {
      status: ProductStatus.ACTIVE,
      isVisible: true,
      deletedAt: null,
      quantity: 3,
    };

    it('is available only with stock, active, visible and not deleted', () => {
      expect(isProductAvailable(base)).toBe(true);
      expect(isProductAvailable({ ...base, quantity: 0 })).toBe(false);
      expect(isProductAvailable({ ...base, status: ProductStatus.SOLD })).toBe(
        false,
      );
    });

    it('reports a sold-out active product as sold', () => {
      expect(unavailableReason({ ...base, quantity: 0 })).toBe('sold');
      expect(unavailableReason(base)).toBeNull();
    });
  });

  describe('ProductsService', () => {
    const ownerId = 'owner-id';
    let service: ProductsService;
    let productRepository: { findOne: jest.Mock; update: jest.Mock };
    let eventEmitter: { emit: jest.Mock };
    let saved: Product[];
    let manager: Record<string, jest.Mock>;
    let locked: Product;
    let created: Record<string, unknown>[];

    const makeProduct = (overrides: Partial<Product> = {}) =>
      ({
        id: 9,
        title: 'Goku',
        price: 100,
        discountPercent: null,
        currency: 'USD',
        type: ProductType.SALE,
        status: ProductStatus.ACTIVE,
        isVisible: true,
        deletedAt: null,
        quantity: 3,
        sellerId: 1,
        seller: { sellerId: 1, userId: ownerId },
        ...overrides,
      }) as unknown as Product;

    beforeEach(() => {
      saved = [];
      created = [];
      eventEmitter = { emit: jest.fn() };
      productRepository = { findOne: jest.fn(), update: jest.fn() };
      locked = makeProduct();
      manager = {
        getRepository: jest.fn(() => ({
          findOne: jest.fn(async () => locked),
        })),
        save: jest.fn(async (_entity: unknown, value: Product) => {
          saved.push({ ...value });
          return { ...value, id: 9 };
        }),
        create: jest.fn((_entity: unknown, value: Record<string, unknown>) => {
          created.push(value);
          return value;
        }),
        delete: jest.fn(),
      };
      const dataSource = {
        transaction: jest.fn(async (cb: (m: unknown) => unknown) =>
          cb(manager),
        ),
      };
      const sellerRepository = {
        findOne: jest.fn().mockResolvedValue({ sellerId: 1, userId: ownerId }),
      };
      const usersService = {
        findById: jest.fn().mockResolvedValue({ currency: 'USD' }),
      };
      const repo = {} as Repository<never>;

      service = new ProductsService(
        productRepository as unknown as Repository<Product>,
        sellerRepository as unknown as Repository<never>,
        repo,
        repo,
        repo,
        repo,
        repo,
        repo,
        usersService as unknown as UsersService,
        {} as unknown as ReviewsService,
        {} as never,
        dataSource as never,
        {} as PriceDisplayService,
        {} as never,
        eventEmitter as never,
      );
      jest.spyOn(service, 'findDetail').mockResolvedValue({} as never);
    });

    const availabilityEvents = () =>
      eventEmitter.emit.mock.calls.filter(
        ([name]: [string]) => name === 'product.availability.changed',
      );

    describe('create', () => {
      const createDraft = (quantity?: number) =>
        service.create(
          null,
          ownerId,
          { title: 'Goku', saveAsDraft: true, quantity },
          undefined,
          undefined,
        );

      it('defaults quantity to 1 when it is not sent', async () => {
        await createDraft();
        expect(created[0]).toMatchObject({ quantity: 1 });
      });

      it('stores the quantity that is sent', async () => {
        await createDraft(4);
        expect(created[0]).toMatchObject({ quantity: 4 });
      });
    });

    describe('update', () => {
      const update = (quantity?: number) =>
        service.update(9, ownerId, { quantity }, undefined, undefined);

      it('lowering stock without reaching 0 keeps it active and does not notify', async () => {
        const product = makeProduct({ quantity: 3 });
        productRepository.findOne.mockResolvedValue(product);
        locked = makeProduct({ quantity: 3 });

        await update(2);

        expect(saved[0]).toMatchObject({
          quantity: 2,
          status: ProductStatus.ACTIVE,
        });
        expect(availabilityEvents()).toHaveLength(0);
      });

      it('quantity 0 sells out the product and notifies the unavailable transition', async () => {
        productRepository.findOne.mockResolvedValue(makeProduct());
        locked = makeProduct({ quantity: 3 });

        await update(0);

        expect(saved[0]).toMatchObject({
          quantity: 0,
          status: ProductStatus.SOLD,
        });
        expect(availabilityEvents()).toHaveLength(1);
        expect(availabilityEvents()[0][1]).toMatchObject({
          productId: 9,
          available: false,
          reason: 'sold',
        });
      });

      it('restocking from 0 makes it available again and notifies once', async () => {
        productRepository.findOne.mockResolvedValue(
          makeProduct({ quantity: 0, status: ProductStatus.SOLD }),
        );
        locked = makeProduct({ quantity: 0, status: ProductStatus.SOLD });

        await update(5);

        expect(saved[0]).toMatchObject({
          quantity: 5,
          status: ProductStatus.ACTIVE,
        });
        expect(availabilityEvents()).toHaveLength(1);
        expect(availabilityEvents()[0][1]).toMatchObject({
          available: true,
          reason: null,
        });
      });

      it('does not touch the status of a paused product when stock changes', async () => {
        productRepository.findOne.mockResolvedValue(
          makeProduct({ status: ProductStatus.INACTIVE }),
        );
        locked = makeProduct({ status: ProductStatus.INACTIVE });

        await update(0);

        expect(saved[0]).toMatchObject({
          quantity: 0,
          status: ProductStatus.INACTIVE,
        });
        expect(availabilityEvents()).toHaveLength(0);
      });

      it('keeps the current stock when the edit does not include quantity (no lost update)', async () => {
        // Lectura vieja: 3. Una compra concurrente ya lo dejó en 2.
        productRepository.findOne.mockResolvedValue(
          makeProduct({ quantity: 3 }),
        );
        locked = makeProduct({ quantity: 2 });

        await service.update(
          9,
          ownerId,
          { title: 'Nuevo título' },
          undefined,
          undefined,
        );

        expect(saved[0]).toMatchObject({
          title: 'Nuevo título',
          quantity: 2,
        });
      });
    });

    describe('updateStatus', () => {
      it('marking as sold leaves the product sold out (quantity 0)', async () => {
        productRepository.findOne.mockResolvedValue(makeProduct());

        await service.updateStatus(9, ownerId, {
          status: ProductStatus.SOLD,
        });

        expect(productRepository.update).toHaveBeenCalledWith(9, {
          status: ProductStatus.SOLD,
          quantity: 0,
        });
        expect(availabilityEvents()).toHaveLength(1);
      });

      it('does not reactivate a paused product without stock', async () => {
        productRepository.findOne.mockResolvedValue(
          makeProduct({ status: ProductStatus.INACTIVE, quantity: 0 }),
        );

        await expect(
          service.updateStatus(9, ownerId, { status: ProductStatus.ACTIVE }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(productRepository.update).not.toHaveBeenCalled();
      });

      it('reactivates a paused product with stock', async () => {
        productRepository.findOne.mockResolvedValue(
          makeProduct({ status: ProductStatus.INACTIVE, quantity: 2 }),
        );

        await service.updateStatus(9, ownerId, {
          status: ProductStatus.ACTIVE,
        });

        expect(productRepository.update).toHaveBeenCalledWith(9, {
          status: ProductStatus.ACTIVE,
          quantity: 2,
        });
      });
    });
  });
});
