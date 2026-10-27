import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  Not,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { Post } from '../community/entities/post.entity';
import { Reply } from '../community/entities/reply.entity';
import { Product } from '../products/entities/product.entity';
import { isConversationParticipant } from '../conversations/conversations.service';
import { Conversation } from '../conversations/entities/conversation.entity';
import { Message } from '../conversations/entities/message.entity';
import { Community } from '../community/entities/community.entity';
import {
  CommunityProfile,
  CommunityProfileRole,
} from '../community/entities/community-profile.entity';
import { User } from '../users/entities/user.entity';
import { CreateReportDto } from './dto/create-report.dto';
import { CommunityReportsQueryDto } from './dto/community-reports-query.dto';
import { GetReportsQueryDto } from './dto/get-reports-query.dto';
import { Report } from './entities/report.entity';
import { ReportItemType } from './enums/report-item-type.enum';
import { ReportStatus } from './enums/report-status.enum';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { ModerationItemType } from '../moderation/enums/moderation-item-type.enum';
import { ModerationService } from '../moderation/moderation.service';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import {
  MODERATION_ACTIONS,
  MODERATION_TARGET_TYPES,
} from '../moderation-actions/constants/moderation-action.constants';
import { ModerationActionsService } from '../moderation-actions/moderation-actions.service';

const REPORT_UNIQUE_CONSTRAINT = 'UQ_report_reporter_id_item_type_item_id';

interface ReportTarget {
  communityId: number | null;
  ownerId?: string;
}

export interface UserSummary {
  id: string;
  username: string;
  photoUrl: string | null;
}

export interface ReportExcerpt {
  title: string | null;
  text: string | null;
}

type LoadedReportTarget = Post | Reply | Product | Conversation;

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectRepository(Report)
    private readonly reportRepository: Repository<Report>,
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
    @InjectRepository(Reply)
    private readonly replyRepository: Repository<Reply>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(Community)
    private readonly communityRepository: Repository<Community>,
    @InjectRepository(CommunityProfile)
    private readonly communityProfileRepository: Repository<CommunityProfile>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly moderationService: ModerationService,
    private readonly notificationsService: NotificationsService,
    private readonly moderationActionsService: ModerationActionsService,
  ) {}

  async createReport(userId: string, dto: CreateReportDto): Promise<Report> {
    const target = await this.resolveTarget(userId, dto.itemType, dto.itemId);

    if (target.ownerId === userId) {
      throw new BadRequestException('No puedes reportar tu propio contenido');
    }

    const existing = await this.reportRepository.findOne({
      where: {
        reporterId: userId,
        itemType: dto.itemType,
        itemId: dto.itemId,
      },
    });
    if (existing) {
      throw new ConflictException('Ya reportaste este contenido');
    }

    const report = this.reportRepository.create({
      reporterId: userId,
      communityId: target.communityId,
      itemType: dto.itemType,
      itemId: dto.itemId,
      reason: dto.reason,
      description: dto.description ?? null,
      status: ReportStatus.PENDING,
      resolvedAt: null,
      resolvedByUserId: null,
      resolutionAction: null,
      resolutionNote: null,
    });

    try {
      return await this.reportRepository.save(report);
    } catch (error: unknown) {
      if (this.isReportUniqueViolation(error)) {
        throw new ConflictException('Ya reportaste este contenido');
      }
      throw error;
    }
  }

  async listCommunityReports(
    communityId: number,
    query: CommunityReportsQueryDto,
  ) {
    await this.ensureCommunityExists(communityId);

    return this.listReports(
      {
        page: query.page,
        limit: query.limit,
        status: query.status,
      },
      communityId,
      false,
    );
  }

  async listGlobalReports(query: GetReportsQueryDto) {
    return this.listReports(query, query.communityId, true);
  }

  private async listReports(
    query: {
      page: number;
      limit: number;
      status?: ReportStatus;
      itemType?: ReportItemType;
    },
    communityId?: number,
    includeCommunity = false,
  ) {
    const reportQuery = this.reportRepository.createQueryBuilder('report');
    if (typeof reportQuery.withDeleted === 'function') {
      reportQuery.withDeleted();
    }
    reportQuery
      .leftJoinAndSelect('report.reporter', 'reporter')
      .where(
        communityId === undefined
          ? '1 = 1'
          : 'report.community_id = :communityId',
        communityId === undefined ? {} : { communityId },
      );

    if (query.status) {
      reportQuery.andWhere('report.status = :status', {
        status: query.status,
      });
    }
    if (query.itemType) {
      reportQuery.andWhere('report.item_type = :itemType', {
        itemType: query.itemType,
      });
    }

    const [reports, total] = await reportQuery
      .orderBy('report.created_at', 'DESC')
      .addOrderBy('report.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    const targets = await this.loadReportTargets(reports);
    const communities = includeCommunity
      ? await this.loadReportCommunities(reports)
      : new Map<
          number,
          { id: number; name: string; slug: string; deletedAt: Date | null }
        >();
    const counts = await this.countReportsByStatus(communityId, query.itemType);

    return {
      data: reports.map((report) => {
        const target = targets.get(
          this.targetKey(report.itemType, report.itemId),
        );
        return {
          id: report.id,
          reason: report.reason,
          status: report.status,
          itemType: report.itemType,
          itemId: report.itemId,
          excerpt: target ? this.buildExcerpt(target) : null,
          contentUnavailable: !target,
          reporter: this.toUserSummary(report.reporter),
          ...(includeCommunity
            ? {
                communityId: report.communityId,
                community: communities.get(report.communityId ?? -1) ?? null,
              }
            : {}),
          createdAt: report.createdAt,
        };
      }),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
      counts,
    };
  }

  private async loadReportCommunities(
    reports: Report[],
  ): Promise<
    Map<
      number,
      { id: number; name: string; slug: string; deletedAt: Date | null }
    >
  > {
    const communityIds = [
      ...new Set(
        reports
          .map((report) => report.communityId)
          .filter((id): id is number => id !== null),
      ),
    ];
    if (communityIds.length === 0) return new Map();

    const communities = await this.communityRepository.find({
      where: { id: In(communityIds) },
      withDeleted: true,
    });
    return new Map(
      communities.map((community) => [
        community.id,
        {
          id: community.id,
          name: community.name,
          slug: community.slug,
          deletedAt: community.deletedAt,
        },
      ]),
    );
  }

  async getCommunityReportDetail(communityId: number, reportId: number) {
    await this.ensureCommunityExists(communityId);

    const report = await this.reportRepository.findOne({
      where: { id: reportId, communityId },
      withDeleted: true,
      relations: { reporter: true, resolvedByUser: true },
    });

    if (!report) {
      throw new NotFoundException('Reporte no encontrado');
    }

    const content = await this.loadReportDetailContent(report);

    return {
      id: report.id,
      reason: report.reason,
      description: report.description,
      status: report.status,
      itemType: report.itemType,
      itemId: report.itemId,
      reporter: this.toUserSummary(report.reporter),
      content: content?.value ?? null,
      contentUnavailable: content === null,
      resolvedAt: report.resolvedAt,
      resolvedByUser: this.toUserSummary(report.resolvedByUser),
      resolutionAction: report.resolutionAction,
      resolutionNote: report.resolutionNote,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };
  }

  async getModerationStats(communityId: number) {
    await this.ensureCommunityExists(communityId);
    const [pendingReports, resolvedToday, activeMembers, activeModerators] =
      await Promise.all([
        this.reportRepository.count({
          where: { communityId, status: ReportStatus.PENDING },
        }),
        this.countResolvedToday(communityId),
        this.countActiveProfiles(communityId),
        this.countActiveProfiles(communityId, true),
      ]);

    return {
      pendingReports,
      resolvedToday,
      activeMembers,
      activeModerators,
    };
  }

  async resolveCommunityReport(
    communityId: number,
    reportId: number,
    dto: ResolveReportDto,
    actorUserId: string,
  ): Promise<Report> {
    await this.ensureCommunityExists(communityId);
    return this.resolveReportInternal(reportId, dto, actorUserId, communityId);
  }

  async resolveGlobalReport(
    reportId: number,
    dto: ResolveReportDto,
    actorUserId: string,
  ): Promise<Report> {
    return this.resolveReportInternal(reportId, dto, actorUserId);
  }

  private async resolveReportInternal(
    reportId: number,
    dto: ResolveReportDto,
    actorUserId: string,
    communityId?: number,
  ): Promise<Report> {
    const actions = this.buildResolutionActions(dto);

    const result = await this.dataSource.transaction(async (manager) => {
      const reportRepository = manager.getRepository(Report);
      const report = await reportRepository.findOne({
        where: {
          id: reportId,
          ...(communityId === undefined ? {} : { communityId }),
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!report) throw new NotFoundException('Reporte no encontrado');
      this.ensurePendingReport(report);

      if (
        dto.hideContent === true &&
        report.itemType === ReportItemType.CONVERSATION
      ) {
        throw new BadRequestException(
          'Las conversaciones no se pueden ocultar',
        );
      }

      const recipientId =
        dto.hideContent === true || dto.warnAuthor === true
          ? await this.findReportAuthorId(report, manager)
          : null;

      const relatedReports =
        dto.hideContent === true
          ? await this.findRelatedPendingReports(manager, report)
          : [];

      if (dto.hideContent === true) {
        await this.moderationService.hideContent(
          this.toModerationItemType(report.itemType),
          report.itemId,
          actorUserId,
          report.reason,
          manager,
        );
      }

      const resolvedAt = new Date();
      const resolutionNote = this.trimNote(dto.note);
      const resolutionAction = actions.join(',');
      report.status = ReportStatus.RESOLVED;
      report.resolvedAt = resolvedAt;
      report.resolvedByUserId = actorUserId;
      report.resolutionAction = resolutionAction;
      report.resolutionNote = resolutionNote;
      const updated = await reportRepository.save(report);

      await this.moderationActionsService.record(
        {
          actorUserId,
          targetType: MODERATION_TARGET_TYPES.REPORT,
          targetId: report.id,
          action: MODERATION_ACTIONS.REPORT_RESOLVED,
          reason: null,
          communityId: report.communityId,
        },
        manager,
      );

      if (dto.warnAuthor === true && recipientId) {
        await this.moderationActionsService.record(
          {
            actorUserId,
            targetType: MODERATION_TARGET_TYPES.USER,
            targetId: recipientId,
            action: MODERATION_ACTIONS.AUTHOR_WARNED,
            reason: report.reason,
            communityId: report.communityId,
          },
          manager,
        );
      }

      if (dto.hideContent === true) {
        await this.resolveRelatedPendingReports(
          manager,
          report,
          resolvedAt,
          actorUserId,
          resolutionAction,
          resolutionNote,
        );
        for (const relatedReport of relatedReports) {
          await this.moderationActionsService.record(
            {
              actorUserId,
              targetType: MODERATION_TARGET_TYPES.REPORT,
              targetId: relatedReport.id,
              action: MODERATION_ACTIONS.REPORT_RESOLVED,
              reason: null,
              communityId: relatedReport.communityId,
            },
            manager,
          );
        }
      }

      return { report: updated, recipientId };
    });

    if (result.recipientId) {
      await this.notifyModeration(result.report, result.recipientId, dto);
    }
    return result.report;
  }

  async dismissCommunityReport(
    communityId: number,
    reportId: number,
    actorUserId: string,
  ): Promise<Report> {
    await this.ensureCommunityExists(communityId);
    return this.dismissReportInternal(reportId, actorUserId, communityId);
  }

  async dismissGlobalReport(
    reportId: number,
    actorUserId: string,
  ): Promise<Report> {
    return this.dismissReportInternal(reportId, actorUserId);
  }

  private async dismissReportInternal(
    reportId: number,
    actorUserId: string,
    communityId?: number,
  ): Promise<Report> {
    return this.dataSource.transaction(async (manager) => {
      const reportRepository = manager.getRepository(Report);
      const report = await reportRepository.findOne({
        where: {
          id: reportId,
          ...(communityId === undefined ? {} : { communityId }),
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!report) throw new NotFoundException('Reporte no encontrado');
      this.ensurePendingReport(report);

      report.status = ReportStatus.DISMISSED;
      report.resolvedAt = new Date();
      report.resolvedByUserId = actorUserId;
      report.resolutionAction = 'dismiss';
      report.resolutionNote = null;
      const updated = await reportRepository.save(report);
      await this.moderationActionsService.record(
        {
          actorUserId,
          targetType: MODERATION_TARGET_TYPES.REPORT,
          targetId: report.id,
          action: MODERATION_ACTIONS.REPORT_DISMISSED,
          reason: null,
          communityId: report.communityId,
        },
        manager,
      );
      return updated;
    });
  }

  private buildResolutionActions(dto: ResolveReportDto): string[] {
    const note = this.trimNote(dto.note);
    const actions: string[] = [];
    if (dto.hideContent === true) actions.push('hide_content');
    if (dto.warnAuthor === true) actions.push('warn_author');
    if (note) actions.push('note');
    if (actions.length === 0) {
      throw new BadRequestException('Debe seleccionarse al menos una acciÃ³n');
    }
    return actions;
  }

  private trimNote(note?: string): string | null {
    if (note === undefined) return null;
    const trimmed = note.trim();
    return trimmed || null;
  }

  private ensurePendingReport(report: Report): void {
    if (report.status !== ReportStatus.PENDING) {
      throw new ConflictException('El reporte ya fue resuelto');
    }
  }

  private toModerationItemType(itemType: ReportItemType): ModerationItemType {
    switch (itemType) {
      case ReportItemType.POST:
        return ModerationItemType.POST;
      case ReportItemType.REPLY:
        return ModerationItemType.REPLY;
      case ReportItemType.PRODUCT:
        return ModerationItemType.PRODUCT;
      default:
        throw new BadRequestException('Tipo de contenido no ocultable');
    }
  }

  private async findReportAuthorId(
    report: Report,
    manager: EntityManager,
  ): Promise<string> {
    switch (report.itemType) {
      case ReportItemType.POST: {
        const post = await manager.getRepository(Post).findOne({
          where: { id: report.itemId },
          relations: { communityProfile: true },
        });
        if (!post) throw new NotFoundException('PublicaciÃ³n no encontrada');
        return post.communityProfile.userId;
      }
      case ReportItemType.REPLY: {
        const reply = await manager.getRepository(Reply).findOne({
          where: { id: report.itemId },
          relations: { communityProfile: true },
        });
        if (!reply) throw new NotFoundException('Respuesta no encontrada');
        return reply.communityProfile.userId;
      }
      case ReportItemType.PRODUCT: {
        const product = await manager.getRepository(Product).findOne({
          where: { id: report.itemId },
          relations: { seller: true },
          withDeleted: true,
        });
        if (!product) throw new NotFoundException('Producto no encontrado');
        return product.seller.userId;
      }
      case ReportItemType.CONVERSATION: {
        const conversation = await manager
          .getRepository(Conversation)
          .findOne({ where: { id: report.itemId }, withDeleted: true });
        if (!conversation) {
          throw new NotFoundException('ConversaciÃ³n no encontrada');
        }
        if (report.reporterId === conversation.buyerId) {
          return conversation.sellerId;
        }
        if (report.reporterId === conversation.sellerId) {
          return conversation.buyerId;
        }
        throw new NotFoundException('Autor del contenido no encontrado');
      }
    }
  }

  private async resolveRelatedPendingReports(
    manager: EntityManager,
    report: Report,
    resolvedAt: Date,
    actorUserId: string,
    resolutionAction: string,
    resolutionNote: string | null,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(Report)
      .set({
        status: ReportStatus.RESOLVED,
        resolvedAt,
        resolvedByUserId: actorUserId,
        resolutionAction,
        resolutionNote,
      })
      .where('item_type = :itemType', { itemType: report.itemType })
      .andWhere('item_id = :itemId', { itemId: report.itemId })
      .andWhere('community_id = :communityId', {
        communityId: report.communityId as number,
      })
      .andWhere('status = :status', { status: ReportStatus.PENDING })
      .execute();
  }

  private findRelatedPendingReports(
    manager: EntityManager,
    report: Report,
  ): Promise<Report[]> {
    return manager.getRepository(Report).find({
      where: {
        id: Not(report.id),
        itemType: report.itemType,
        itemId: report.itemId,
        communityId: report.communityId as number,
        status: ReportStatus.PENDING,
      },
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
  }

  private async notifyModeration(
    report: Report,
    recipientId: string,
    dto: ResolveReportDto,
  ): Promise<void> {
    const hiding = dto.hideContent === true;
    try {
      await this.notificationsService.notify([
        {
          userId: recipientId,
          type: hiding
            ? NotificationType.CONTENT_HIDDEN
            : NotificationType.MODERATION_WARNING,
          data: {
            itemType: report.itemType,
            itemId: report.itemId,
            communityId: report.communityId,
            ...(hiding ? { reason: report.reason } : {}),
            ...(dto.warnAuthor === true ? { warned: true } : {}),
          },
          message: hiding
            ? 'Tu contenido fue ocultado por moderaciÃ³n'
            : 'Recibiste una advertencia de moderaciÃ³n',
        },
      ]);
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo notificar la moderaciÃ³n del reporte ${report.id}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async resolveTarget(
    userId: string,
    itemType: ReportItemType,
    itemId: number,
  ): Promise<ReportTarget> {
    switch (itemType) {
      case ReportItemType.POST:
        return this.resolvePost(itemId);
      case ReportItemType.REPLY:
        return this.resolveReply(itemId);
      case ReportItemType.PRODUCT:
        return this.resolveProduct(itemId);
      case ReportItemType.CONVERSATION:
        return this.resolveConversation(userId, itemId);
    }
  }

  private async resolvePost(itemId: number): Promise<ReportTarget> {
    const post = await this.postRepository.findOne({
      where: { id: itemId },
      relations: { communityProfile: true },
    });
    if (!post) throw new NotFoundException('Publicación no encontrada');

    return {
      ownerId: post.communityProfile.userId,
      communityId: post.communityProfile.communityId,
    };
  }

  private async resolveReply(itemId: number): Promise<ReportTarget> {
    const reply = await this.replyRepository.findOne({
      where: { id: itemId },
      relations: { communityProfile: true, post: { communityProfile: true } },
    });
    if (!reply) throw new NotFoundException('Respuesta no encontrada');

    return {
      ownerId: reply.communityProfile.userId,
      communityId: reply.post.communityProfile.communityId,
    };
  }

  private async resolveProduct(itemId: number): Promise<ReportTarget> {
    const product = await this.productRepository.findOne({
      where: { id: itemId },
      relations: { seller: true },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');

    return {
      ownerId: product.seller.userId,
      communityId: product.communityId,
    };
  }

  private async resolveConversation(
    userId: string,
    itemId: number,
  ): Promise<ReportTarget> {
    const conversation = await this.conversationRepository
      .createQueryBuilder('conversation')
      .withDeleted()
      .leftJoinAndSelect('conversation.product', 'product')
      .where('conversation.id = :itemId', { itemId })
      .getOne();

    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }
    if (!isConversationParticipant(conversation, userId)) {
      throw new ForbiddenException('No participas en esta conversación');
    }

    return { communityId: conversation.product.communityId };
  }

  private isReportUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as {
      code?: string;
      constraint?: string;
    };
    return (
      driverError.code === '23505' &&
      driverError.constraint === REPORT_UNIQUE_CONSTRAINT
    );
  }

  private async ensureCommunityExists(communityId: number): Promise<void> {
    const community = await this.communityRepository.findOne({
      where: { id: communityId },
      select: { id: true },
    });
    if (!community) {
      throw new NotFoundException('Comunidad no encontrada');
    }
  }

  private async loadReportTargets(
    reports: Report[],
  ): Promise<Map<string, LoadedReportTarget>> {
    const idsByType = new Map<ReportItemType, number[]>();
    for (const report of reports) {
      const ids = idsByType.get(report.itemType) ?? [];
      ids.push(report.itemId);
      idsByType.set(report.itemType, ids);
    }

    const targets = new Map<string, LoadedReportTarget>();
    const postIds = idsByType.get(ReportItemType.POST) ?? [];
    if (postIds.length > 0) {
      const posts = await this.postRepository.find({
        where: { id: In(postIds) },
        relations: {
          communityProfile: { user: true },
          postTags: { tag: true },
          images: true,
        },
      });
      posts.forEach((target) =>
        targets.set(this.targetKey(ReportItemType.POST, target.id), target),
      );
    }

    const replyIds = idsByType.get(ReportItemType.REPLY) ?? [];
    if (replyIds.length > 0) {
      const replies = await this.replyRepository.find({
        where: { id: In(replyIds) },
        relations: { communityProfile: { user: true } },
      });
      replies.forEach((target) =>
        targets.set(this.targetKey(ReportItemType.REPLY, target.id), target),
      );
    }

    const productIds = idsByType.get(ReportItemType.PRODUCT) ?? [];
    if (productIds.length > 0) {
      const products = await this.productRepository.find({
        where: { id: In(productIds) },
        relations: { seller: { user: true }, community: true },
        withDeleted: true,
      });
      products.forEach((target) =>
        targets.set(this.targetKey(ReportItemType.PRODUCT, target.id), target),
      );
    }

    const conversationIds = idsByType.get(ReportItemType.CONVERSATION) ?? [];
    if (conversationIds.length > 0) {
      const conversations = await this.conversationRepository.find({
        where: { id: In(conversationIds) },
        relations: { product: true },
        withDeleted: true,
      });
      conversations.forEach((target) =>
        targets.set(
          this.targetKey(ReportItemType.CONVERSATION, target.id),
          target,
        ),
      );

      const messages = await this.messageRepository.find({
        where: { conversationId: In(conversationIds) },
        order: { createdAt: 'DESC', id: 'DESC' },
      });
      const latestMessages = new Map<number, Message>();
      for (const message of messages) {
        if (!latestMessages.has(message.conversationId)) {
          latestMessages.set(message.conversationId, message);
        }
      }
      for (const conversation of conversations) {
        const latest = latestMessages.get(conversation.id);
        (
          conversation as Conversation & { latestMessage?: Message }
        ).latestMessage = latest;
      }
    }

    return targets;
  }

  private async loadReportDetailContent(
    report: Report,
  ): Promise<{ value: unknown } | null> {
    switch (report.itemType) {
      case ReportItemType.POST: {
        const post = await this.postRepository.findOne({
          where: { id: report.itemId },
          relations: {
            communityProfile: { user: true },
            postTags: { tag: true },
            images: true,
          },
        });
        return post ? { value: this.mapPostDetail(post) } : null;
      }
      case ReportItemType.REPLY: {
        const reply = await this.replyRepository.findOne({
          where: { id: report.itemId },
          relations: { communityProfile: { user: true } },
        });
        return reply ? { value: this.mapReplyDetail(reply) } : null;
      }
      case ReportItemType.PRODUCT: {
        const product = await this.productRepository.findOne({
          where: { id: report.itemId },
          relations: { seller: { user: true }, community: true },
          withDeleted: true,
        });
        return product ? { value: this.mapProductDetail(product) } : null;
      }
      case ReportItemType.CONVERSATION: {
        const conversation = await this.conversationRepository.findOne({
          where: { id: report.itemId },
          relations: { product: true },
          withDeleted: true,
        });
        if (!conversation) return null;
        const messages = await this.messageRepository.find({
          where: { conversationId: conversation.id },
          relations: { sender: true },
          order: { createdAt: 'ASC', id: 'ASC' },
        });
        return {
          value: {
            id: conversation.id,
            buyerId: conversation.buyerId,
            sellerId: conversation.sellerId,
            productId: conversation.productId,
            product: conversation.product
              ? {
                  id: conversation.product.id,
                  title: conversation.product.title,
                }
              : null,
            messages: messages.map((message) => ({
              id: message.id,
              type: message.type,
              content: message.content,
              imageUrl: message.imageUrl,
              createdAt: message.createdAt,
              sender: message.sender
                ? this.toUserSummary(message.sender)
                : null,
            })),
          },
        };
      }
    }
  }

  private buildExcerpt(target: LoadedReportTarget): ReportExcerpt {
    if (target instanceof Post) {
      return { title: target.title, text: this.truncate(target.body) };
    }
    if (target instanceof Reply) {
      return { title: null, text: this.truncate(target.body) };
    }
    if (target instanceof Product) {
      return {
        title: target.title,
        text: this.truncate(target.description),
      };
    }

    const latestMessage = (target as Conversation & { latestMessage?: Message })
      .latestMessage;
    return {
      title: target.product?.title ?? null,
      text: latestMessage
        ? latestMessage.content
          ? this.truncate(latestMessage.content)
          : latestMessage.imageUrl
            ? '[Imagen]'
            : null
        : null,
    };
  }

  private truncate(value: string | null | undefined): string | null {
    if (!value) return null;
    const text = value.trim();
    return text.length > 160 ? `${text.slice(0, 157)}...` : text;
  }

  private async countReportsByStatus(
    communityId?: number,
    itemType?: ReportItemType,
  ) {
    const query = this.reportRepository
      .createQueryBuilder('report')
      .select('report.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where(
        communityId === undefined
          ? '1 = 1'
          : 'report.community_id = :communityId',
        communityId === undefined ? {} : { communityId },
      );
    if (itemType) {
      query.andWhere('report.item_type = :itemType', { itemType });
    }
    const rows = await query
      .groupBy('report.status')
      .getRawMany<{ status: ReportStatus; count: string }>();

    const counts = {
      pending: 0,
      resolved: 0,
      dismissed: 0,
    };
    for (const row of rows) {
      counts[row.status] = Number(row.count);
    }
    return counts;
  }

  private async countResolvedToday(communityId: number): Promise<number> {
    const { start, next } = this.getCostaRicaDayRangeUtc();
    return this.reportRepository
      .createQueryBuilder('report')
      .where('report.community_id = :communityId', { communityId })
      .andWhere('report.status = :status', { status: ReportStatus.RESOLVED })
      .andWhere('report.resolved_at >= :start', { start })
      .andWhere('report.resolved_at < :next', { next })
      .getCount();
  }

  private countActiveProfiles(
    communityId: number,
    moderatorsOnly = false,
  ): Promise<number> {
    const query = this.communityProfileRepository
      .createQueryBuilder('profile')
      .innerJoin(User, 'user', 'user.id = profile.user_id')
      .where('profile.community_id = :communityId', { communityId })
      .andWhere('user.is_active = true');
    if (moderatorsOnly) {
      query.andWhere('profile.role IN (:...roles)', {
        roles: [CommunityProfileRole.OWNER, CommunityProfileRole.MODERATOR],
      });
    }
    return query.getCount();
  }

  private getCostaRicaDayRangeUtc(): { start: Date; next: Date } {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Costa_Rica',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );
    const start = new Date(
      Date.UTC(values.year, values.month - 1, values.day, 6),
    );
    return { start, next: new Date(start.getTime() + 86_400_000) };
  }

  private targetKey(itemType: ReportItemType, itemId: number): string {
    return `${itemType}:${itemId}`;
  }

  private toUserSummary(user: User | null | undefined): UserSummary | null {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      photoUrl: user.photoUrl ?? null,
    };
  }

  private mapPostDetail(post: Post) {
    return {
      id: post.id,
      title: post.title,
      body: post.body,
      postedAt: post.postedAt,
      author: post.communityProfile
        ? {
            communityProfileId: post.communityProfile.communityProfileId,
            displayName: post.communityProfile.displayName,
            role: post.communityProfile.role,
            photoUrl: post.communityProfile.user?.photoUrl ?? null,
          }
        : null,
      tags: (post.postTags ?? []).map(({ tag }) => ({
        tagId: tag.tagId,
        name: tag.name,
      })),
      images: post.images ?? [],
      isHidden: post.isHidden,
      hiddenAt: post.hiddenAt,
      hiddenReason: post.hiddenReason,
    };
  }

  private mapReplyDetail(reply: Reply) {
    return {
      id: reply.id,
      body: reply.body,
      postedAt: reply.postedAt,
      postId: reply.postId,
      communityProfileId: reply.communityProfileId,
      parentReplyId: reply.parentReplyId,
      author: reply.communityProfile
        ? {
            communityProfileId: reply.communityProfile.communityProfileId,
            displayName: reply.communityProfile.displayName,
            role: reply.communityProfile.role,
            photoUrl: reply.communityProfile.user?.photoUrl ?? null,
          }
        : null,
      isHidden: reply.isHidden,
      hiddenAt: reply.hiddenAt,
      hiddenReason: reply.hiddenReason,
    };
  }

  private mapProductDetail(product: Product) {
    return {
      id: product.id,
      title: product.title,
      description: product.description,
      price: product.price,
      currency: product.currency,
      status: product.status,
      isVisible: product.isVisible,
      isHidden: product.isHidden,
      hiddenAt: product.hiddenAt,
      hiddenReason: product.hiddenReason,
      communityId: product.communityId,
      seller: product.seller
        ? {
            sellerId: product.seller.sellerId,
            displayName: product.seller.displayName,
            photoUrl: product.seller.user?.photoUrl ?? null,
          }
        : null,
    };
  }
}
