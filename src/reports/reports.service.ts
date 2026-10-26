import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Post } from '../community/entities/post.entity';
import { Reply } from '../community/entities/reply.entity';
import { Product } from '../products/entities/product.entity';
import { isConversationParticipant } from '../conversations/conversations.service';
import { Conversation } from '../conversations/entities/conversation.entity';
import { CreateReportDto } from './dto/create-report.dto';
import { Report } from './entities/report.entity';
import { ReportItemType } from './enums/report-item-type.enum';
import { ReportStatus } from './enums/report-status.enum';

const REPORT_UNIQUE_CONSTRAINT = 'UQ_report_reporter_id_item_type_item_id';

interface ReportTarget {
  communityId: number | null;
  ownerId?: string;
}

@Injectable()
export class ReportsService {
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
}
