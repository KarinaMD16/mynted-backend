import { UserRole } from '../users/entities/user.entity';
import { CommunityService } from './community.service';
import { CommunityProfileRole } from './entities/community-profile.entity';
import { CommunityProfile } from './entities/community-profile.entity';
import { Community } from './entities/community.entity';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import { MODERATION_ACTIONS } from '../moderation-actions/constants/moderation-action.constants';

describe('CommunityService administrative community actions', () => {
  const createHarness = (community: Record<string, unknown>) => {
    const saved = jest.fn((value: unknown) => value);
    const findOne = jest.fn(() => community);
    const manager = {
      getRepository: jest.fn(() => ({ findOne, save: saved })),
    };
    const service = Object.create(
      CommunityService.prototype,
    ) as CommunityService & Record<string, unknown>;

    const auditMock = { record: jest.fn() };
    const notifyMock = { notify: jest.fn().mockResolvedValue([]) };
    const internals = service as unknown as Record<string, unknown>;
    internals.usersService = {
      findById: jest.fn().mockResolvedValue({ role: UserRole.SUPERADMIN }),
    };
    internals.dataSource = {
      transaction: jest.fn((callback: (value: unknown) => unknown) =>
        callback(manager),
      ),
    };
    internals.moderationActionsService = auditMock;
    internals.notificationsService = notifyMock;
    internals.communityProfileRepository = {
      find: jest.fn().mockResolvedValue([
        {
          userId: 'owner',
          role: CommunityProfileRole.OWNER,
          user: { isActive: true },
        },
        {
          userId: 'moderator',
          role: CommunityProfileRole.MODERATOR,
          user: { isActive: true },
        },
        {
          userId: 'moderator',
          role: CommunityProfileRole.MODERATOR,
          user: { isActive: true },
        },
      ]),
    };

    return { service, findOne, saved, manager, auditMock, notifyMock };
  };

  const createCommunityHarness = (ownerId?: string) => {
    const communityRepository = { findOne: jest.fn().mockResolvedValue(null) };
    const categoryRepository = {
      findOne: jest.fn().mockResolvedValue({ categoryId: 1, isActive: true }),
    };
    const tagRepository = { find: jest.fn().mockResolvedValue([{ tagId: 1 }]) };
    const actor = {
      id: 'admin-id',
      username: 'admin',
      role: UserRole.SUPERADMIN,
      isActive: true,
    };
    const assignedOwner = {
      id: ownerId,
      username: 'owner',
      role: UserRole.USER,
      isActive: true,
    };
    const usersService = {
      findById: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(id === 'admin-id' ? actor : assignedOwner),
        ),
    };
    const manager = {
      create: jest.fn((_entity: unknown, value: unknown) => value),
      save: jest.fn().mockImplementation((entity: unknown, value: unknown) => {
        if (entity === Community)
          return Promise.resolve({ ...(value as object), id: 8 });
        if (entity === CommunityProfile) {
          return Promise.resolve({
            ...(value as object),
            communityProfileId: 12,
          });
        }
        return Promise.resolve(value);
      }),
      findOne: jest.fn().mockResolvedValue({
        id: 8,
        name: 'Nueva',
        category: {},
        communityTags: [],
        rules: [],
      }),
    };
    const service = Object.create(
      CommunityService.prototype,
    ) as CommunityService;
    const internals = service as unknown as Record<string, unknown>;
    internals.communityRepository = communityRepository;
    internals.categoryRepository = categoryRepository;
    internals.tagRepository = tagRepository;
    internals.usersService = usersService;
    internals.dataSource = {
      transaction: jest.fn((callback: (value: unknown) => unknown) =>
        callback(manager),
      ),
    };
    internals.eventEmitter = { emit: jest.fn() };
    return { service, manager, ownerId };
  };

  it('audits and notifies recipients only after a real SUPERADMIN transition', async () => {
    const community = {
      id: 4,
      name: 'Comunidad',
      isActive: true,
      isPrivate: false,
    };
    const { service, auditMock, notifyMock } = createHarness(community);

    await service.deactivate(4, 'admin-id');

    expect(community.isActive).toBe(false);
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-id',
        targetType: 'community',
        targetId: 4,
        action: MODERATION_ACTIONS.COMMUNITY_DEACTIVATED,
        communityId: 4,
        reason: null,
      }),
      expect.anything(),
    );
    expect(notifyMock.notify).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'owner',
        type: NotificationType.COMMUNITY_DEACTIVATED,
      }),
      expect.objectContaining({
        userId: 'moderator',
        type: NotificationType.COMMUNITY_DEACTIVATED,
      }),
    ]);
  });

  it('does not audit or notify an idempotent SUPERADMIN transition', async () => {
    const community = {
      id: 4,
      name: 'Comunidad',
      isActive: false,
      isPrivate: false,
    };
    const { service, auditMock, notifyMock } = createHarness(community);

    await service.deactivate(4, 'admin-id');

    expect(auditMock.record).not.toHaveBeenCalled();
    expect(notifyMock.notify).not.toHaveBeenCalled();
  });

  it('maps independent administrative counts without mixing their sources', () => {
    const service = Object.create(
      CommunityService.prototype,
    ) as CommunityService;
    const result = (
      service as unknown as {
        mapAdminCommunityList: (
          communities: unknown[],
          rawRows: Record<string, unknown>[],
        ) => unknown[];
      }
    ).mapAdminCommunityList(
      [
        {
          id: 4,
          name: 'Comunidad',
          slug: 'comunidad',
          description: 'Descripción',
          isActive: false,
          isPrivate: true,
          category: { categoryId: 2, name: 'Coleccionismo' },
          createdAt: new Date(),
        },
      ],
      [
        {
          admin_member_count: '4',
          admin_product_count: '6',
          admin_pending_reports_count: '2',
        },
      ],
    );

    expect(result[0]).toEqual(
      expect.objectContaining({
        memberCount: 4,
        productCount: 6,
        pendingReportsCount: 2,
        isActive: false,
        isPrivate: true,
      }),
    );
  });

  it('includes a community without profiles and maps memberCount to zero', () => {
    const service = Object.create(
      CommunityService.prototype,
    ) as CommunityService & Record<string, unknown>;
    const queryBuilder = {
      subQuery: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getQuery: jest.fn().mockReturnValue('(SELECT COUNT(*))'),
      withDeleted: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
    };
    const internals = service as unknown as {
      communityRepository: { createQueryBuilder: jest.Mock };
      buildAdminCommunityListQuery: (query: Record<string, unknown>) => unknown;
    };
    internals.communityRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    internals.buildAdminCommunityListQuery.call(service, {});

    expect(queryBuilder.withDeleted).toHaveBeenCalled();

    const result = (
      service as unknown as {
        mapAdminCommunityList: (
          communities: unknown[],
          rawRows: Record<string, unknown>[],
        ) => unknown[];
      }
    ).mapAdminCommunityList(
      [
        {
          id: 4,
          name: 'Comunidad sin owner',
          slug: 'comunidad-sin-owner',
          description: 'Sin perfiles',
          isActive: true,
          isPrivate: false,
          category: null,
          createdAt: new Date(),
          deletedAt: null,
        },
      ],
      [
        {
          admin_member_count: '0',
          admin_product_count: '0',
          admin_pending_reports_count: '0',
        },
      ],
    );

    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 4,
        memberCount: 0,
        productCount: 0,
        pendingReportsCount: 0,
        deletedAt: null,
      }),
    );
  });

  it('soft-deletes a community, audits it and notifies moderators once', async () => {
    const community = {
      id: 4,
      name: 'Comunidad',
      deletedAt: null,
    };
    const findOne = jest.fn().mockResolvedValue(community);
    const softDelete = jest.fn().mockResolvedValue({ affected: 1 });
    const auditMock = { record: jest.fn() };
    const notifyMock = { notify: jest.fn().mockResolvedValue([]) };
    const service = Object.create(
      CommunityService.prototype,
    ) as CommunityService;
    const internals = service as unknown as Record<string, unknown>;
    internals.dataSource = {
      transaction: jest.fn((callback: (value: unknown) => unknown) =>
        callback({
          getRepository: jest.fn(() => ({ findOne, softDelete })),
        }),
      ),
    };
    internals.moderationActionsService = auditMock;
    internals.notificationsService = notifyMock;
    internals.communityProfileRepository = {
      find: jest.fn().mockResolvedValue([]),
    };

    await service.deleteCommunity(4, 'admin-id', {
      reason: 'Prueba TASK 1149',
    });

    expect(softDelete).toHaveBeenCalledWith(4);
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-id',
        targetType: 'community',
        targetId: 4,
        action: 'community_soft_deleted',
        communityId: 4,
        reason: 'Prueba TASK 1149',
      }),
      expect.anything(),
    );
  });

  it('allows SUPERADMIN to create without an owner profile when ownerId is omitted', async () => {
    const { service, manager } = createCommunityHarness();

    await service.create(
      {
        name: 'Nueva',
        description: 'Descripción',
        slug: 'nueva',
        isPrivate: false,
        categoryId: 1,
        tagIds: [1],
        rules: ['Regla'],
      },
      undefined,
      undefined,
      'admin-id',
    );

    expect(manager.save).not.toHaveBeenCalledWith(
      CommunityProfile,
      expect.anything(),
    );
  });

  it('allows SUPERADMIN to assign an active user as owner', async () => {
    const ownerId = 'owner-id';
    const { service, manager } = createCommunityHarness(ownerId);

    await service.create(
      {
        name: 'Nueva',
        description: 'Descripción',
        slug: 'nueva',
        isPrivate: false,
        categoryId: 1,
        tagIds: [1],
        rules: ['Regla'],
        ownerId,
      },
      undefined,
      undefined,
      'admin-id',
    );

    expect(manager.save).toHaveBeenCalledWith(
      CommunityProfile,
      expect.objectContaining({
        userId: ownerId,
        role: CommunityProfileRole.OWNER,
        displayName: 'owner',
        bio: '',
      }),
    );
  });

  it('does not repeat audit or soft delete for an already deleted community', async () => {
    const findOne = jest.fn().mockResolvedValue({
      id: 4,
      name: 'Comunidad',
      deletedAt: new Date(),
    });
    const softDelete = jest.fn();
    const auditMock = { record: jest.fn() };
    const notifyMock = { notify: jest.fn() };
    const service = Object.create(
      CommunityService.prototype,
    ) as CommunityService;
    const internals = service as unknown as Record<string, unknown>;
    internals.dataSource = {
      transaction: jest.fn((callback: (value: unknown) => unknown) =>
        callback({
          getRepository: jest.fn(() => ({ findOne, softDelete })),
        }),
      ),
    };
    internals.moderationActionsService = auditMock;
    internals.notificationsService = notifyMock;

    await service.deleteCommunity(4, 'admin-id', { reason: 'Repetido' });

    expect(softDelete).not.toHaveBeenCalled();
    expect(auditMock.record).not.toHaveBeenCalled();
    expect(notifyMock.notify).not.toHaveBeenCalled();
  });
});
