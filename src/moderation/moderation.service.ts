import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Post } from '../community/entities/post.entity';
import { Reply } from '../community/entities/reply.entity';
import { Product } from '../products/entities/product.entity';
import { ModerationItemType } from './enums/moderation-item-type.enum';

type Moderatable = Post | Reply | Product;

@Injectable()
export class ModerationService {
  constructor(
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
    @InjectRepository(Reply)
    private readonly replyRepository: Repository<Reply>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  async hideContent(
    itemType: ModerationItemType,
    itemId: number,
    actorUserId: string,
    reason?: string,
  ): Promise<Moderatable> {
    if (!Number.isInteger(itemId) || itemId < 1) {
      throw new BadRequestException('itemId debe ser un entero positivo');
    }
    const content = await this.findContent(itemType, itemId);
    if (content.isHidden) return content;
    const trimmedReason = reason?.trim();
    content.isHidden = true;
    content.hiddenAt ??= new Date();
    content.hiddenByUserId = actorUserId;
    content.hiddenReason = trimmedReason || null;
    return this.saveContent(itemType, content);
  }

  async restoreContent(
    itemType: ModerationItemType,
    itemId: number,
    communityId: number,
    actorUserId: string,
  ): Promise<Moderatable> {
    void actorUserId;
    if (
      !Number.isInteger(itemId) ||
      itemId < 1 ||
      !Number.isInteger(communityId) ||
      communityId < 1
    ) {
      throw new BadRequestException('itemId debe ser un entero positivo');
    }
    const content = await this.findContent(itemType, itemId);
    const contentCommunityId = this.getCommunityId(itemType, content);
    if (contentCommunityId === null || contentCommunityId !== communityId) {
      throw new NotFoundException('Contenido no encontrado');
    }
    if (!content.isHidden) return content;

    content.isHidden = false;
    content.hiddenAt = null;
    content.hiddenByUserId = null;
    content.hiddenReason = null;
    return this.saveContent(itemType, content);
  }

  private async findContent(
    itemType: ModerationItemType,
    itemId: number,
  ): Promise<Moderatable> {
    switch (itemType) {
      case ModerationItemType.POST: {
        const post = await this.postRepository.findOne({
          where: { id: itemId },
          relations: { communityProfile: true },
        });
        if (!post) throw new NotFoundException('Publicación no encontrada');
        return post;
      }
      case ModerationItemType.REPLY: {
        const reply = await this.replyRepository.findOne({
          where: { id: itemId },
          relations: { post: { communityProfile: true } },
        });
        if (!reply) throw new NotFoundException('Respuesta no encontrada');
        return reply;
      }
      case ModerationItemType.PRODUCT: {
        const product = await this.productRepository.findOne({
          where: { id: itemId },
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
  ): Promise<Moderatable> {
    switch (itemType) {
      case ModerationItemType.POST:
        return this.postRepository.save(content as Post);
      case ModerationItemType.REPLY:
        return this.replyRepository.save(content as Reply);
      case ModerationItemType.PRODUCT:
        return this.productRepository.save(content as Product);
      default:
        throw new BadRequestException('Tipo de contenido no válido');
    }
  }
}
