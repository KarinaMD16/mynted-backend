import { BadRequestException } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import {
  MODERATION_ACTIONS,
  MODERATION_TARGET_TYPES,
} from './constants/moderation-action.constants';
import { ModerationAction } from './entities/moderation-action.entity';
import { ModerationActionsService } from './moderation-actions.service';

describe('ModerationActionsService', () => {
  const repository = {
    create: jest.fn((value: Partial<ModerationAction>) => value),
    save: jest.fn(),
    findAndCount: jest.fn(),
  };
  const managerRepository = {
    create: jest.fn((value: Partial<ModerationAction>) => value),
    save: jest.fn(),
  };
  const manager = {
    getRepository: jest.fn().mockReturnValue(managerRepository),
  };
  const service = new ModerationActionsService(
    repository as unknown as Repository<ModerationAction>,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    repository.save.mockImplementation((value: unknown) =>
      Promise.resolve(value),
    );
    managerRepository.save.mockImplementation((value: unknown) =>
      Promise.resolve(value),
    );
  });

  it('normalizes numeric target ids and keeps nullable fields', async () => {
    const result = await service.record({
      actorUserId: 'actor-id',
      targetType: MODERATION_TARGET_TYPES.POST,
      targetId: 3,
      action: MODERATION_ACTIONS.CONTENT_HIDDEN,
    });

    expect(result).toEqual(
      expect.objectContaining({
        actorUserId: 'actor-id',
        targetId: '3',
        reason: null,
        communityId: null,
      }),
    );
    expect(repository.save).toHaveBeenCalled();
  });

  it('normalizes UUID target ids and uses the transaction manager', async () => {
    await service.record(
      {
        actorUserId: 'actor-id',
        targetType: MODERATION_TARGET_TYPES.USER,
        targetId: 'target-uuid',
        action: MODERATION_ACTIONS.AUTHOR_WARNED,
        reason: 'spam',
        communityId: 2,
      },
      manager as unknown as EntityManager,
    );

    expect(manager.getRepository).toHaveBeenCalledWith(ModerationAction);
    expect(managerRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'target-uuid',
        reason: 'spam',
        communityId: 2,
      }),
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects missing actor, target or action', async () => {
    await expect(
      service.record({
        actorUserId: '',
        targetType: MODERATION_TARGET_TYPES.POST,
        targetId: 1,
        action: MODERATION_ACTIONS.CONTENT_HIDDEN,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.record({
        actorUserId: 'actor-id',
        targetType: MODERATION_TARGET_TYPES.POST,
        targetId: '',
        action: MODERATION_ACTIONS.CONTENT_HIDDEN,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists actions with actor data and deterministic pagination order', async () => {
    repository.findAndCount.mockResolvedValue([
      [
        Object.assign(new ModerationAction(), {
          id: 2,
          action: MODERATION_ACTIONS.CONTENT_HIDDEN,
          targetType: MODERATION_TARGET_TYPES.POST,
          targetId: '3',
          reason: 'spam',
          communityId: 2,
          createdAt: new Date(),
          actor: {
            id: 'actor-id',
            username: 'moderator',
            photoUrl: null,
            role: 'user',
          },
        }),
      ],
      1,
    ]);

    const result = await service.findAll({ page: 1, limit: 20 });

    expect(repository.findAndCount).toHaveBeenCalledWith({
      relations: { actor: true },
      withDeleted: true,
      where: {},
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: 0,
      take: 20,
    });
    expect(result.data[0].actor).toEqual(
      expect.objectContaining({ id: 'actor-id', username: 'moderator' }),
    );
    expect(result.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('applies all optional filters with AND semantics and preserves pagination order', async () => {
    repository.findAndCount.mockResolvedValue([[], 0]);
    const from = '2026-10-01T00:00:00.000Z';
    const to = '2026-10-31T23:59:59.999Z';

    await service.findAll({
      page: 2,
      limit: 10,
      action: MODERATION_ACTIONS.REPORT_RESOLVED,
      targetType: MODERATION_TARGET_TYPES.REPORT,
      targetId: '8',
      communityId: 2,
      actorUserId: '550e8400-e29b-41d4-a716-446655440000',
      from,
      to,
    });

    const calls = repository.findAndCount.mock.calls as unknown[][];
    const options = calls[0]?.[0];
    expect(options).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          action: MODERATION_ACTIONS.REPORT_RESOLVED,
          targetType: MODERATION_TARGET_TYPES.REPORT,
          targetId: '8',
          communityId: 2,
          actorUserId: '550e8400-e29b-41d4-a716-446655440000',
          createdAt: expect.any(Object) as unknown,
        }) as unknown,
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: 10,
        take: 10,
      }),
    );
  });

  it('rejects an inverted date range', async () => {
    await expect(
      service.findAll({
        page: 1,
        limit: 20,
        from: '2026-11-01T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
      }),
    ).rejects.toThrow('from no puede ser posterior a to');
    expect(repository.findAndCount).not.toHaveBeenCalled();
  });
});
