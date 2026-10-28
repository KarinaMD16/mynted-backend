import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { Post } from '../community/entities/post.entity';
import { Reply } from '../community/entities/reply.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { Product } from '../products/entities/product.entity';
import { CreateReportDto } from './dto/create-report.dto';
import { Report } from './entities/report.entity';
import { ReportItemType } from './enums/report-item-type.enum';
import { ReportReason } from './enums/report-reason.enum';
import { ReportStatus } from './enums/report-status.enum';
import { ReportsService } from './reports.service';
import { Message } from '../conversations/entities/message.entity';
import { Community } from '../community/entities/community.entity';
import { CommunityProfile } from '../community/entities/community-profile.entity';
import { User } from '../users/entities/user.entity';

describe('ReportsService', () => {
  const reporterId = 'reporter-id';
  const ownerId = 'owner-id';
  const reportRepository = {
    findOne: jest.fn(),
    create: jest.fn((value: Partial<Report>) => value),
    save: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const postRepository = { findOne: jest.fn() };
  const replyRepository = { findOne: jest.fn() };
  const productRepository = { findOne: jest.fn() };
  const conversationQueryBuilder = {
    withDeleted: jest.fn(),
    leftJoinAndSelect: jest.fn(),
    where: jest.fn(),
    getOne: jest.fn(),
  };
  const conversationRepository = {
    createQueryBuilder: jest.fn(() => conversationQueryBuilder),
    find: jest.fn(),
    findOne: jest.fn(),
  };
  const messageRepository = { find: jest.fn() };
  const communityRepository = { findOne: jest.fn(), find: jest.fn() };
  const communityProfileRepository = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
  };
  const userRepository = { find: jest.fn() };
  const dataSource = { transaction: jest.fn() };
  const moderationService = { hideContent: jest.fn() };
  const notificationsService = { notify: jest.fn() };
  const moderationActionsService = { record: jest.fn() };
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
    moderationService as never,
    notificationsService as never,
    moderationActionsService as never,
  );

  const dto = (itemType: ReportItemType, itemId = 7): CreateReportDto => ({
    itemType,
    itemId,
    reason: ReportReason.SPAM,
    description: '  motivo  ',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    conversationQueryBuilder.withDeleted.mockReturnValue(
      conversationQueryBuilder,
    );
    conversationQueryBuilder.leftJoinAndSelect.mockReturnValue(
      conversationQueryBuilder,
    );
    conversationQueryBuilder.where.mockReturnValue(conversationQueryBuilder);
    reportRepository.findOne.mockResolvedValue(null);
    reportRepository.save.mockImplementation((report: Report) =>
      Promise.resolve(report),
    );
    communityRepository.findOne.mockResolvedValue({ id: 12 });
    communityRepository.find.mockResolvedValue([]);
    communityProfileRepository.findOne.mockResolvedValue(null);
  });

  it('creates a pending post report with reporter and community derived from the post', async () => {
    postRepository.findOne.mockResolvedValue({
      communityProfile: { userId: ownerId, communityId: 12 },
    });

    const result = await service.createReport(
      reporterId,
      dto(ReportItemType.POST),
    );

    expect(result).toEqual(
      expect.objectContaining({
        reporterId,
        communityId: 12,
        itemType: ReportItemType.POST,
        itemId: 7,
        status: ReportStatus.PENDING,
        description: '  motivo  ',
      }),
    );
  });

  it('derives the community through the post for a reply', async () => {
    replyRepository.findOne.mockResolvedValue({
      communityProfile: { userId: ownerId },
      post: { communityProfile: { communityId: 14 } },
    });

    const result = await service.createReport(
      reporterId,
      dto(ReportItemType.REPLY),
    );

    expect(result.communityId).toBe(14);
  });

  it('creates a report for a public community without an owner', async () => {
    communityRepository.findOne.mockResolvedValue({
      id: 2,
      isPrivate: false,
    });

    const result = await service.createReport(
      reporterId,
      dto(ReportItemType.COMMUNITY, 2),
    );

    expect(result).toEqual(
      expect.objectContaining({
        itemType: ReportItemType.COMMUNITY,
        itemId: 2,
        communityId: 2,
        status: ReportStatus.PENDING,
      }),
    );
  });

  it('allows reporting an inactive community that is not soft-deleted', async () => {
    communityRepository.findOne.mockResolvedValue({
      id: 2,
      isActive: false,
      isPrivate: false,
    });

    await expect(
      service.createReport(reporterId, dto(ReportItemType.COMMUNITY, 2)),
    ).resolves.toEqual(
      expect.objectContaining({
        itemType: ReportItemType.COMMUNITY,
        communityId: 2,
      }),
    );
    expect(communityRepository.findOne).toHaveBeenCalledWith({
      where: { id: 2 },
    });
  });

  it('allows a member to report a private community', async () => {
    communityRepository.findOne.mockResolvedValue({
      id: 2,
      isPrivate: true,
    });
    communityProfileRepository.findOne.mockResolvedValue({
      communityProfileId: 10,
    });

    await expect(
      service.createReport(reporterId, dto(ReportItemType.COMMUNITY, 2)),
    ).resolves.toEqual(
      expect.objectContaining({
        itemType: ReportItemType.COMMUNITY,
        communityId: 2,
      }),
    );
  });

  it('rejects a private community report from a non-member', async () => {
    communityRepository.findOne.mockResolvedValue({
      id: 2,
      isPrivate: true,
    });
    communityProfileRepository.findOne.mockResolvedValue(null);

    await expect(
      service.createReport(reporterId, dto(ReportItemType.COMMUNITY, 2)),
    ).rejects.toThrow(ForbiddenException);
    expect(reportRepository.save).not.toHaveBeenCalled();
  });

  it('rejects a missing community report target', async () => {
    communityRepository.findOne.mockResolvedValue(null);

    await expect(
      service.createReport(reporterId, dto(ReportItemType.COMMUNITY, 999)),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a duplicate report for the same community and reporter', async () => {
    communityRepository.findOne.mockResolvedValue({
      id: 2,
      isPrivate: false,
    });
    reportRepository.findOne.mockResolvedValue({ id: 8 });

    await expect(
      service.createReport(reporterId, dto(ReportItemType.COMMUNITY, 2)),
    ).rejects.toThrow(ConflictException);
    expect(reportRepository.save).not.toHaveBeenCalled();
  });

  it('derives the owner and nullable community from a product', async () => {
    productRepository.findOne.mockResolvedValue({
      seller: { userId: ownerId },
      communityId: null,
    });

    const result = await service.createReport(
      reporterId,
      dto(ReportItemType.PRODUCT),
    );

    expect(result.communityId).toBeNull();
    expect(productRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ relations: { seller: true } }),
    );
  });

  it.each(['buyer-id', 'seller-id'])(
    'allows either conversation participant (%s)',
    async (participantId) => {
      conversationQueryBuilder.getOne.mockResolvedValue({
        buyerId: 'buyer-id',
        sellerId: 'seller-id',
        product: { communityId: 20 },
      });

      const result = await service.createReport(
        participantId,
        dto(ReportItemType.CONVERSATION),
      );

      expect(result.communityId).toBe(20);
      expect(conversationQueryBuilder.withDeleted).toHaveBeenCalled();
    },
  );

  it('allows a conversation whose product has no community', async () => {
    conversationQueryBuilder.getOne.mockResolvedValue({
      buyerId: reporterId,
      sellerId: ownerId,
      product: { communityId: null },
    });

    const result = await service.createReport(
      reporterId,
      dto(ReportItemType.CONVERSATION),
    );

    expect(result.communityId).toBeNull();
  });

  it.each([ReportItemType.POST, ReportItemType.REPLY, ReportItemType.PRODUCT])(
    'rejects self-report for %s',
    async (itemType) => {
      const target = {
        communityProfile: { userId: reporterId, communityId: 1 },
      };
      if (itemType === ReportItemType.POST)
        postRepository.findOne.mockResolvedValue(target);
      if (itemType === ReportItemType.REPLY) {
        replyRepository.findOne.mockResolvedValue({
          communityProfile: { userId: reporterId },
          post: { communityProfile: { communityId: 1 } },
        });
      }
      if (itemType === ReportItemType.PRODUCT) {
        productRepository.findOne.mockResolvedValue({
          seller: { userId: reporterId },
          communityId: 1,
        });
      }

      await expect(
        service.createReport(reporterId, dto(itemType)),
      ).rejects.toThrow(BadRequestException);
      expect(reportRepository.save).not.toHaveBeenCalled();
    },
  );

  it('rejects a conversation from a non-participant', async () => {
    conversationQueryBuilder.getOne.mockResolvedValue({
      buyerId: 'buyer-id',
      sellerId: 'seller-id',
      product: { communityId: 1 },
    });

    await expect(
      service.createReport('intruder-id', dto(ReportItemType.CONVERSATION)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects missing content', async () => {
    postRepository.findOne.mockResolvedValue(null);

    await expect(
      service.createReport(reporterId, dto(ReportItemType.POST)),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a duplicate before saving', async () => {
    postRepository.findOne.mockResolvedValue({
      communityProfile: { userId: ownerId, communityId: 1 },
    });
    reportRepository.findOne.mockResolvedValue({ id: 1 });

    await expect(
      service.createReport(reporterId, dto(ReportItemType.POST)),
    ).rejects.toThrow(ConflictException);
    expect(reportRepository.save).not.toHaveBeenCalled();
  });

  it('converts only the report unique constraint violation to conflict', async () => {
    postRepository.findOne.mockResolvedValue({
      communityProfile: { userId: ownerId, communityId: 1 },
    });
    reportRepository.save.mockRejectedValue(
      new QueryFailedError('INSERT', [], {
        code: '23505',
        constraint: 'UQ_report_reporter_id_item_type_item_id',
      } as unknown as Error),
    );

    await expect(
      service.createReport(reporterId, dto(ReportItemType.POST)),
    ).rejects.toThrow(ConflictException);
  });
});
