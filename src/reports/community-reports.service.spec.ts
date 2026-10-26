import { Repository } from 'typeorm';
import { Community } from '../community/entities/community.entity';
import { CommunityProfile } from '../community/entities/community-profile.entity';
import { Post } from '../community/entities/post.entity';
import { Message } from '../conversations/entities/message.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { Product } from '../products/entities/product.entity';
import { User } from '../users/entities/user.entity';
import { Report } from './entities/report.entity';
import { ReportItemType } from './enums/report-item-type.enum';
import { ReportReason } from './enums/report-reason.enum';
import { ReportStatus } from './enums/report-status.enum';
import { ReportsService } from './reports.service';

const chain = () => {
  const qb = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
    getRawMany: jest.fn(),
    getCount: jest.fn(),
  };
  return qb;
};

describe('ReportsService community reports', () => {
  const reportRepository = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
    count: jest.fn(),
  };
  const postRepository = { find: jest.fn(), findOne: jest.fn() };
  const replyRepository = { find: jest.fn(), findOne: jest.fn() };
  const productRepository = { find: jest.fn(), findOne: jest.fn() };
  const conversationRepository = { find: jest.fn(), findOne: jest.fn() };
  const messageRepository = { find: jest.fn() };
  const communityRepository = { findOne: jest.fn() };
  const communityProfileRepository = { createQueryBuilder: jest.fn() };
  const userRepository = { find: jest.fn() };

  const service = new ReportsService(
    reportRepository as unknown as Repository<Report>,
    postRepository as unknown as Repository<Post>,
    replyRepository as unknown as Repository<never>,
    productRepository as unknown as Repository<Product>,
    conversationRepository as unknown as Repository<Conversation>,
    messageRepository as unknown as Repository<Message>,
    communityRepository as unknown as Repository<Community>,
    communityProfileRepository as unknown as Repository<CommunityProfile>,
    userRepository as unknown as Repository<User>,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    communityRepository.findOne.mockResolvedValue({ id: 7 });
  });

  it('lists paginated reports, counts all statuses and batches post targets', async () => {
    const listQb = chain();
    const countsQb = chain();
    reportRepository.createQueryBuilder
      .mockReturnValueOnce(listQb)
      .mockReturnValueOnce(countsQb);
    const post = Object.assign(new Post(), {
      id: 15,
      title: 'Título',
      body: 'Contenido del post',
    });
    const report = {
      id: 1,
      reason: ReportReason.SPAM,
      status: ReportStatus.PENDING,
      itemType: ReportItemType.POST,
      itemId: 15,
      reporter: { id: 'u1', username: 'reporter', photoUrl: null },
      createdAt: new Date(),
    } as unknown as Report;
    listQb.getManyAndCount.mockResolvedValue([[report], 1]);
    countsQb.getRawMany.mockResolvedValue([
      { status: ReportStatus.PENDING, count: '1' },
      { status: ReportStatus.RESOLVED, count: '2' },
    ]);
    postRepository.find.mockResolvedValue([post]);

    const result = await service.listCommunityReports(7, {
      page: 1,
      limit: 20,
      status: undefined,
    });

    expect(postRepository.find).toHaveBeenCalledTimes(1);
    expect(result.data[0]).toEqual(
      expect.objectContaining({
        id: 1,
        excerpt: { title: 'Título', text: 'Contenido del post' },
        contentUnavailable: false,
      }),
    );
    expect(result.counts).toEqual({ pending: 1, resolved: 2, dismissed: 0 });
    expect(listQb.orderBy).toHaveBeenCalledWith('report.created_at', 'DESC');
    expect(listQb.addOrderBy).toHaveBeenCalledWith('report.id', 'DESC');
  });

  it('returns hidden post content in report detail', async () => {
    const report = {
      id: 1,
      communityId: 7,
      reason: ReportReason.SPAM,
      status: ReportStatus.PENDING,
      itemType: ReportItemType.POST,
      itemId: 15,
      reporter: { id: 'u1', username: 'reporter', photoUrl: null },
      resolvedByUser: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Report;
    const post = Object.assign(new Post(), {
      id: 15,
      title: 'Oculto',
      body: 'Contenido oculto',
      isHidden: true,
      hiddenAt: new Date(),
      hiddenReason: 'moderación',
      postTags: [],
      images: [],
      communityProfile: null,
    });
    reportRepository.findOne.mockResolvedValue(report);
    postRepository.findOne.mockResolvedValue(post);

    const result = await service.getCommunityReportDetail(7, 1);

    expect(result.content).toEqual(
      expect.objectContaining({ id: 15, isHidden: true }),
    );
    expect(result.contentUnavailable).toBe(false);
  });

  it('calculates pending, resolved today and active member/moderator counts', async () => {
    const resolvedQb = chain();
    const membersQb = chain();
    const moderatorsQb = chain();
    reportRepository.count.mockResolvedValue(3);
    reportRepository.createQueryBuilder.mockReturnValue(resolvedQb);
    communityProfileRepository.createQueryBuilder
      .mockReturnValueOnce(membersQb)
      .mockReturnValueOnce(moderatorsQb);
    resolvedQb.getCount.mockResolvedValue(2);
    membersQb.getCount.mockResolvedValue(10);
    moderatorsQb.getCount.mockResolvedValue(3);

    await expect(service.getModerationStats(7)).resolves.toEqual({
      pendingReports: 3,
      resolvedToday: 2,
      activeMembers: 10,
      activeModerators: 3,
    });
    expect(membersQb.andWhere).toHaveBeenCalledWith('user.is_active = true');
    expect(moderatorsQb.andWhere).toHaveBeenCalledWith(
      'profile.role IN (:...roles)',
      expect.any(Object),
    );
  });
});
