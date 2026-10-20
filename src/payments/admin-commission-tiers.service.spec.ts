/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { ConflictException, BadRequestException } from '@nestjs/common';
import { AdminCommissionTiersService } from './admin-commission-tiers.service';
import { CommissionTierType } from './enums/commission-tier-type.enum';

describe('AdminCommissionTiersService', () => {
  const tier = (overrides = {}) => ({
    id: 1,
    type: CommissionTierType.SALES,
    name: 'Bronce',
    minValue: 0,
    maxValue: 10,
    currency: null,
    discount: 0,
    isActive: true,
    ...overrides,
  });

  const create = (rows: unknown[] = []) => {
    const repository = {
      find: jest.fn().mockResolvedValue(rows),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn((value: unknown) => value),
      create: jest.fn((value) => value),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(repository) };
    const dataSource = {
      transaction: jest.fn((callback) => callback(manager)),
    };
    return {
      service: new AdminCommissionTiersService(
        repository as never,
        dataSource as never,
      ),
      repository,
      manager,
      dataSource,
    };
  };

  it('creates new tiers inactive by default', async () => {
    const h = create();
    const result = await h.service.create({
      type: CommissionTierType.SALES,
      name: 'Nuevo',
      minValue: 0,
      maxValue: null,
      discount: 0.01,
    });
    expect(result.isActive).toBe(false);
    expect(h.dataSource.transaction).toHaveBeenCalled();
  });

  it('rejects inconsistent fields before saving', async () => {
    const h = create();
    await expect(
      h.service.create({
        type: CommissionTierType.SALES,
        name: 'Sales',
        minValue: 0,
        maxValue: 1,
        currency: 'USD',
        discount: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.repository.save).not.toHaveBeenCalled();
  });

  it('rejects gaps and overlaps in an active group', async () => {
    const rows = [
      tier({ id: 1, minValue: 0, maxValue: 10 }),
      tier({ id: 2, minValue: 10, maxValue: null }),
    ];
    const h = create(rows);
    await expect(
      h.service.create({
        type: CommissionTierType.SALES,
        name: 'Roto',
        minValue: 20,
        maxValue: 30,
        discount: 0,
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('soft deactivates only when coverage remains valid', async () => {
    const rows = [
      tier({ id: 1, minValue: 0, maxValue: 10 }),
      tier({ id: 2, minValue: 10, maxValue: null }),
    ];
    const h = create(rows);
    h.repository.findOne.mockResolvedValue(rows[1]);
    await expect(h.service.remove(2)).resolves.toMatchObject({
      isActive: false,
    });
    expect(h.repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false }),
    );
  });

  it('rejects deactivation that removes the only active coverage', async () => {
    const only = tier({ id: 1, minValue: 0, maxValue: null });
    const h = create([only]);
    h.repository.findOne.mockResolvedValue(only);
    await expect(h.service.remove(1)).rejects.toBeInstanceOf(ConflictException);
    expect(h.repository.save).not.toHaveBeenCalled();
  });
});
