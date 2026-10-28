import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { Post } from '../community/entities/post.entity';
import { Community } from '../community/entities/community.entity';
import { CommunityProfile } from '../community/entities/community-profile.entity';
import { Reply } from '../community/entities/reply.entity';
import { Product } from '../products/entities/product.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { Message } from '../conversations/entities/message.entity';
import { User } from '../users/entities/user.entity';
import { ModerationService } from '../moderation/moderation.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReportsService } from './reports.service';
import { Report } from './entities/report.entity';
import { ReportItemType } from './enums/report-item-type.enum';
import { ReportReason } from './enums/report-reason.enum';
import { ReportStatus } from './enums/report-status.enum';

describe('ReportsService resolution', () => {
  const communityId = 7;
  const actorId = 'moderator-id';
  const authorId = 'author-id';
  const reportRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };
  const postRepository = { findOne: jest.fn() };
  const replyRepository = { findOne: jest.fn() };
  const productRepository = { findOne: jest.fn() };
  const conversationRepository = { findOne: jest.fn() };
  const messageRepository = { find: jest.fn() };
  const communityRepository = { findOne: jest.fn() };
  const communityProfileRepository = { createQueryBuilder: jest.fn() };
  const userRepository = { find: jest.fn() };
  const moderationService = { hideContent: jest.fn() };
  const notificationsService = { notify: jest.fn() };
  const moderationActionsService = { record: jest.fn() };
  const updateQuery = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 2 }),
  };
  const repositories = new Map<unknown, unknown>([
    [Report, reportRepository],
    [Post, postRepository],
    [Reply, replyRepository],
    [Product, productRepository],
    [Conversation, conversationRepository],
  ]);
  const manager = {
    getRepository: jest.fn((entity: unknown) => repositories.get(entity)),
    createQueryBuilder: jest.fn(() => updateQuery),
  };
  const dataSource = {
    transaction: jest.fn((callback: (value: typeof manager) => unknown) =>
      callback(manager),
    ),
  };
  const service = new ReportsService(
    reportRepository as unknown as Repository<Report>,
    postRepository as unknown as Repository<Post>,
    replyRepository as unknown as Repository<Reply>,
    productRepository as unknown as Repository<Product>,
    conversationRepository as unknown as Repository<Conversation>,
    messageRepository as unknown as Repository<Message>,
    communityRepository as unknown as Repository<Community>,
    communityProfileRepository as unknown as Repository<CommunityProfile>,
    userRepository as unknown as Repository<User>,
    dataSource as never,
    moderationService as unknown as ModerationService,
    notificationsService as unknown as NotificationsService,
    moderationActionsService as never,
  );

  const pendingReport = (overrides: Partial<Report> = {}) =>
    Object.assign(new Report(), {
      id: 15,
      communityId,
      reporterId: 'reporter-id',
      itemType: ReportItemType.POST,
      itemId: 42,
      reason: ReportReason.SPAM,
      status: ReportStatus.PENDING,
      ...overrides,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    communityRepository.findOne.mockResolvedValue({ id: communityId });
    reportRepository.save.mockImplementation((value: Report) =>
      Promise.resolve(value),
    );
    reportRepository.find.mockResolvedValue([]);
    notificationsService.notify.mockResolvedValue([]);
    updateQuery.execute.mockResolvedValue({ affected: 2 });
  });

  it('resolves and hides a post, batch-resolving related pending reports', async () => {
    const report = pendingReport();
    const post = { id: 42, communityProfile: { userId: authorId } };
    reportRepository.findOne.mockResolvedValue(report);
    postRepository.findOne.mockResolvedValue(post);
    moderationService.hideContent.mockResolvedValue(post);

    const result = await service.resolveCommunityReport(
      communityId,
      report.id,
      { hideContent: true, warnAuthor: true, note: ' Revisado ' },
      actorId,
    );

    expect(result).toMatchObject({
      status: ReportStatus.RESOLVED,
      resolvedByUserId: actorId,
      resolutionAction: 'hide_content,warn_author,note',
      resolutionNote: 'Revisado',
    });
    expect(moderationService.hideContent).toHaveBeenCalledWith(
      'post',
      42,
      actorId,
      ReportReason.SPAM,
      manager,
    );
    expect(updateQuery.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ReportStatus.RESOLVED,
        resolvedByUserId: actorId,
        resolutionAction: 'hide_content,warn_author,note',
        resolutionNote: 'Revisado',
      }),
    );
    expect(notificationsService.notify).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: authorId,
        type: 'content_hidden',
      }),
    ]);
    expect(JSON.stringify(notificationsService.notify.mock.calls[0])).toContain(
      '"itemId":42',
    );
    expect(
      JSON.stringify(notificationsService.notify.mock.calls[0]),
    ).not.toContain('reporter-id');
    expect(moderationActionsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'report',
        targetId: report.id,
        action: 'report_resolved',
        communityId,
      }),
      manager,
    );
    expect(moderationActionsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'user',
        targetId: authorId,
        action: 'author_warned',
        communityId,
      }),
      manager,
    );
  });

  it('resolves a reply and a product through the existing moderation service', async () => {
    const cases: Array<{
      itemType: ReportItemType.REPLY | ReportItemType.PRODUCT;
      repository: { findOne: jest.Mock };
      target: object;
    }> = [
      {
        itemType: ReportItemType.REPLY,
        repository: replyRepository,
        target: { id: 42, communityProfile: { userId: authorId } },
      },
      {
        itemType: ReportItemType.PRODUCT,
        repository: productRepository,
        target: { id: 42, seller: { userId: authorId } },
      },
    ];
    for (const { itemType, repository, target } of cases) {
      const report = pendingReport({ itemType });
      reportRepository.findOne.mockResolvedValue(report);
      repository.findOne.mockResolvedValue(target);
      moderationService.hideContent.mockResolvedValue(target);

      await service.resolveCommunityReport(
        communityId,
        report.id,
        { hideContent: true },
        actorId,
      );

      expect(moderationService.hideContent).toHaveBeenCalledWith(
        itemType,
        42,
        actorId,
        ReportReason.SPAM,
        manager,
      );
    }
  });

  it('records one content event and one report event per pending batch report', async () => {
    const report = pendingReport({ id: 15 });
    const relatedReports = [
      pendingReport({ id: 16 }),
      pendingReport({ id: 17 }),
      pendingReport({ id: 18 }),
    ];
    const post = { id: 42, communityProfile: { userId: authorId } };
    reportRepository.findOne.mockResolvedValue(report);
    reportRepository.find.mockResolvedValue(relatedReports);
    postRepository.findOne.mockResolvedValue(post);
    moderationService.hideContent.mockResolvedValue(post);

    await service.resolveCommunityReport(
      communityId,
      report.id,
      { hideContent: true },
      actorId,
    );

    expect(moderationActionsService.record).toHaveBeenCalledTimes(4);
    const recordedInputs = (
      moderationActionsService.record.mock.calls as unknown as Array<
        [Record<string, unknown>]
      >
    ).map(([input]) => input);
    expect(recordedInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'report_resolved',
          targetId: 15,
        }),
        expect.objectContaining({
          action: 'report_resolved',
          targetId: 16,
        }),
        expect.objectContaining({
          action: 'report_resolved',
          targetId: 17,
        }),
        expect.objectContaining({
          action: 'report_resolved',
          targetId: 18,
        }),
      ]),
    );
  });

  it('rejects hiding conversations', async () => {
    reportRepository.findOne.mockResolvedValue(
      pendingReport({ itemType: ReportItemType.CONVERSATION }),
    );

    await expect(
      service.resolveCommunityReport(
        communityId,
        15,
        { hideContent: true },
        actorId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(moderationService.hideContent).not.toHaveBeenCalled();
  });

  it('allows note-only resolution without loading the target or notifying', async () => {
    const report = pendingReport();
    reportRepository.findOne.mockResolvedValue(report);

    await service.resolveCommunityReport(
      communityId,
      report.id,
      { note: '  Nota interna  ' },
      actorId,
    );

    expect(report.resolutionAction).toBe('note');
    expect(report.resolutionNote).toBe('Nota interna');
    expect(postRepository.findOne).not.toHaveBeenCalled();
    expect(notificationsService.notify).not.toHaveBeenCalled();
    expect(updateQuery.execute).not.toHaveBeenCalled();
  });

  it('hides a community report from the community resolve route', async () => {
    const report = pendingReport({
      itemType: ReportItemType.COMMUNITY,
      itemId: communityId,
    });
    reportRepository.findOne.mockResolvedValue(report);

    await expect(
      service.resolveCommunityReport(
        communityId,
        report.id,
        { hideContent: false, warnAuthor: false, note: 'Revisión completada' },
        actorId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(report.status).toBe(ReportStatus.PENDING);
    expect(moderationService.hideContent).not.toHaveBeenCalled();
    expect(notificationsService.notify).not.toHaveBeenCalled();
    expect(moderationActionsService.record).not.toHaveBeenCalled();
  });

  it.each([
    { hideContent: true },
    { warnAuthor: true },
    { hideContent: true, note: 'No permitido' },
    { warnAuthor: true, note: 'No permitido' },
  ])('rejects unsupported actions for community reports: %j', async (dto) => {
    const report = pendingReport({
      itemType: ReportItemType.COMMUNITY,
      itemId: communityId,
    });
    reportRepository.findOne.mockResolvedValue(report);

    await expect(
      service.resolveGlobalReport(report.id, dto, actorId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(report.status).toBe(ReportStatus.PENDING);
    expect(moderationService.hideContent).not.toHaveBeenCalled();
    expect(moderationActionsService.record).not.toHaveBeenCalled();
  });

  it('resolves a global report without requiring a community', async () => {
    const report = pendingReport({ communityId: null });
    reportRepository.findOne.mockResolvedValue(report);

    await service.resolveGlobalReport(
      report.id,
      { note: 'Nota global' },
      'superadmin-id',
    );

    expect(communityRepository.findOne).not.toHaveBeenCalled();
    expect(report.resolvedByUserId).toBe('superadmin-id');
    expect(moderationActionsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'report_resolved',
        communityId: null,
        actorUserId: 'superadmin-id',
      }),
      manager,
    );
  });

  it('allows SUPERADMIN to resolve a community report with a note', async () => {
    const report = pendingReport({
      itemType: ReportItemType.COMMUNITY,
      itemId: communityId,
    });
    reportRepository.findOne.mockResolvedValue(report);

    await expect(
      service.resolveGlobalReport(
        report.id,
        { hideContent: false, warnAuthor: false, note: 'Revisión global' },
        'superadmin-id',
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        status: ReportStatus.RESOLVED,
        resolutionAction: 'note',
      }),
    );
    expect(moderationService.hideContent).not.toHaveBeenCalled();
  });

  it('dismisses a global report from a soft-deleted community', async () => {
    const report = pendingReport({ communityId: 99 });
    reportRepository.findOne.mockResolvedValue(report);

    await service.dismissGlobalReport(report.id, 'superadmin-id');

    expect(communityRepository.findOne).not.toHaveBeenCalled();
    expect(report.status).toBe(ReportStatus.DISMISSED);
    expect(moderationActionsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'report_dismissed',
        communityId: 99,
        actorUserId: 'superadmin-id',
      }),
      manager,
    );
  });

  it.each([
    {},
    { hideContent: false, warnAuthor: false },
    { hideContent: false, warnAuthor: false, note: '   ' },
  ])('rejects a resolution without a real action: %j', async (dto) => {
    await expect(
      service.resolveCommunityReport(communityId, 15, dto, actorId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('returns conflict when the report is already resolved or dismissed', async () => {
    for (const status of [ReportStatus.RESOLVED, ReportStatus.DISMISSED]) {
      reportRepository.findOne.mockResolvedValue(pendingReport({ status }));
      await expect(
        service.dismissCommunityReport(communityId, 15, actorId),
      ).rejects.toBeInstanceOf(ConflictException);
    }
  });

  it('dismisses a pending report without touching content or notifications', async () => {
    const report = pendingReport();
    reportRepository.findOne.mockResolvedValue(report);

    const result = await service.dismissCommunityReport(
      communityId,
      report.id,
      actorId,
    );

    expect(result).toMatchObject({
      status: ReportStatus.DISMISSED,
      resolvedByUserId: actorId,
      resolutionAction: 'dismiss',
      resolutionNote: null,
    });
    expect(moderationService.hideContent).not.toHaveBeenCalled();
    expect(notificationsService.notify).not.toHaveBeenCalled();
    expect(moderationActionsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'report',
        targetId: report.id,
        action: 'report_dismissed',
        communityId,
      }),
      manager,
    );
  });

  it('returns not found for a report outside the requested community', async () => {
    reportRepository.findOne.mockResolvedValue(null);

    await expect(
      service.dismissCommunityReport(communityId, 99, actorId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
