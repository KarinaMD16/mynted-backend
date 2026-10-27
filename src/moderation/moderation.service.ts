import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Post } from '../community/entities/post.entity';
import { Reply } from '../community/entities/reply.entity';
import { Product } from '../products/entities/product.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import {
  MODERATION_ACTIONS,
  MODERATION_TARGET_TYPES,
  ModerationTargetType,
} from '../moderation-actions/constants/moderation-action.constants';
import { ModerationActionsService } from '../moderation-actions/moderation-actions.service';
import { ModerationItemType } from './enums/moderation-item-type.enum';

type Moderatable = Post | Reply | Product;

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
    @InjectRepository(Reply)
    private readonly replyRepository: Repository<Reply>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @Optional()
    private readonly notificationsService?: NotificationsService,
    @Optional()
    private readonly dataSource?: DataSource,
    @Optional()
    private readonly moderationActionsService?: ModerationActionsService,
  ) {}

  async hideContent(
    itemType: ModerationItemType,
    itemId: number,
    actorUserId: string,
    reason?: string,
    manager?: EntityManager,
  ): Promise<Moderatable> {
    if (!manager && this.dataSource) {
      return this.dataSource.transaction((transactionManager) =>
        this.hideContent(
          itemType,
          itemId,
          actorUserId,
          reason,
          transactionManager,
        ),
      );
    }

    return this.hideContentInManager(
      itemType,
      itemId,
      actorUserId,
      reason,
      manager,
    );
  }

  private async hideContentInManager(
    itemType: ModerationItemType,
    itemId: number,
    actorUserId: string,
    reason?: string,
    manager?: EntityManager,
  ): Promise<Moderatable> {
    if (!Number.isInteger(itemId) || itemId < 1) {
      throw new BadRequestException('itemId debe ser un entero positivo');
    }
    const content = await this.findContent(itemType, itemId, manager);
    if (content.isHidden) return content;
    const communityId = this.getCommunityId(itemType, content);
    const trimmedReason = reason?.trim();
    content.isHidden = true;
    content.hiddenAt ??= new Date();
    content.hiddenByUserId = actorUserId;
    content.hiddenReason = trimmedReason || null;
    const saved = await this.saveContent(itemType, content, manager);
    await this.moderationActionsService?.record(
      {
        actorUserId,
        targetType: this.toTargetType(itemType),
        targetId: itemId,
        action: MODERATION_ACTIONS.CONTENT_HIDDEN,
        reason: trimmedReason || null,
        communityId,
      },
      manager,
    );
    return saved;
  }

  async restoreContent(
    itemType: ModerationItemType,
    itemId: number,
    communityId: number,
    actorUserId: string,
  ): Promise<Moderatable> {
    if (this.dataSource) {
      const result = await this.dataSource.transaction((transactionManager) =>
        this.restoreContentInManager(
          itemType,
          itemId,
          communityId,
          actorUserId,
          transactionManager,
        ),
      );
      if (result.changed) await this.notifyRestored(itemType, result.content);
      return result.content;
    }
    const result = await this.restoreContentInManager(
      itemType,
      itemId,
      communityId,
      actorUserId,
    );
    if (result.changed) await this.notifyRestored(itemType, result.content);
    return result.content;
  }

  private async restoreContentInManager(
    itemType: ModerationItemType,
    itemId: number,
    communityId: number,
    actorUserId: string,
    manager?: EntityManager,
  ): Promise<{ content: Moderatable; changed: boolean }> {
    void actorUserId;
    if (
      !Number.isInteger(itemId) ||
      itemId < 1 ||
      !Number.isInteger(communityId) ||
      communityId < 1
    ) {
      throw new BadRequestException('itemId debe ser un entero positivo');
    }
    const content = await this.findContent(itemType, itemId, manager);
    const contentCommunityId = this.getCommunityId(itemType, content);
    if (contentCommunityId === null || contentCommunityId !== communityId) {
      throw new NotFoundException('Contenido no encontrado');
    }
    if (!content.isHidden) return { content, changed: false };

    content.isHidden = false;
    content.hiddenAt = null;
    content.hiddenByUserId = null;
    content.hiddenReason = null;
    const restored = await this.saveContent(itemType, content, manager);
    await this.moderationActionsService?.record(
      {
        actorUserId,
        targetType: this.toTargetType(itemType),
        targetId: itemId,
        action: MODERATION_ACTIONS.CONTENT_RESTORED,
        reason: null,
        communityId: contentCommunityId,
      },
      manager,
    );
    return { content: restored, changed: true };
  }

  private toTargetType(itemType: ModerationItemType): ModerationTargetType {
    switch (itemType) {
      case ModerationItemType.POST:
        return MODERATION_TARGET_TYPES.POST;
      case ModerationItemType.REPLY:
        return MODERATION_TARGET_TYPES.REPLY;
      case ModerationItemType.PRODUCT:
        return MODERATION_TARGET_TYPES.PRODUCT;
      default:
        throw new BadRequestException('Tipo de contenido no vÃ¡lido');
    }
  }

  private async findContent(
    itemType: ModerationItemType,
    itemId: number,
    manager?: EntityManager,
  ): Promise<Moderatable> {
    const postRepository = manager?.getRepository(Post) ?? this.postRepository;
    const replyRepository =
      manager?.getRepository(Reply) ?? this.replyRepository;
    const productRepository =
      manager?.getRepository(Product) ?? this.productRepository;

    switch (itemType) {
      case ModerationItemType.POST: {
        const post = await postRepository.findOne({
          where: { id: itemId },
          relations: { communityProfile: true },
        });
        if (!post) throw new NotFoundException('Publicación no encontrada');
        return post;
      }
      case ModerationItemType.REPLY: {
        const reply = await replyRepository.findOne({
          where: { id: itemId },
          relations: {
            communityProfile: true,
            post: { communityProfile: true },
          },
        });
        if (!reply) throw new NotFoundException('Respuesta no encontrada');
        return reply;
      }
      case ModerationItemType.PRODUCT: {
        const product = await productRepository.findOne({
          where: { id: itemId },
          relations: { seller: true },
          withDeleted: true,
        });
        if (!product) throw new NotFoundException('Producto no encontrado');
        return product;
      }
      default:
        throw new BadRequestException('Tipo de contenido no válido');
    }
  }

  private getCommunityId(
    itemType: ModerationItemType,
    content: Moderatable,
  ): number | null {
    if (itemType === ModerationItemType.POST) {
      return (content as Post).communityProfile?.communityId ?? null;
    }
    if (itemType === ModerationItemType.REPLY) {
      return (content as Reply).post?.communityProfile?.communityId ?? null;
    }
    return (content as Product).communityId;
  }

  private saveContent(
    itemType: ModerationItemType,
    content: Moderatable,
    manager?: EntityManager,
  ): Promise<Moderatable> {
    const postRepository = manager?.getRepository(Post) ?? this.postRepository;
    const replyRepository =
      manager?.getRepository(Reply) ?? this.replyRepository;
    const productRepository =
      manager?.getRepository(Product) ?? this.productRepository;

    switch (itemType) {
      case ModerationItemType.POST:
        return postRepository.save(content as Post);
      case ModerationItemType.REPLY:
        return replyRepository.save(content as Reply);
      case ModerationItemType.PRODUCT:
        return productRepository.save(content as Product);
      default:
        throw new BadRequestException('Tipo de contenido no válido');
    }
  }

  private async notifyRestored(
    itemType: ModerationItemType,
    content: Moderatable,
  ): Promise<void> {
    if (!this.notificationsService) return;

    const recipientId =
      itemType === ModerationItemType.POST
        ? (content as Post).communityProfile?.userId
        : itemType === ModerationItemType.REPLY
          ? (content as Reply).communityProfile?.userId
          : (content as Product).seller?.userId;

    if (!recipientId) return;

    try {
      await this.notificationsService.notify([
        {
          userId: recipientId,
          type: NotificationType.CONTENT_RESTORED,
          data: { itemType, itemId: content.id },
          message: 'Tu contenido fue restaurado por moderaciÃ³n',
        },
      ]);
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo notificar la restauraciÃ³n de ${itemType}:${content.id}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
