import { UserRole } from '../users/entities/user.entity';
import { CommunityService } from './community.service';
import { CommunityProfileRole } from './entities/community-profile.entity';
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
});
