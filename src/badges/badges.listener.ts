import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  BadgeEvents,
  FavoriteSavedEvent,
  MemberJoinedEvent,
  PostCreatedEvent,
  PostUpvotedEvent,
  ProductPublishedEvent,
  ReplyCreatedEvent,
  SellerApprovedEvent,
  UserRegisteredEvent,
} from './badge-events';
import { BadgesService } from './badges.service';

@Injectable()
export class BadgesListener {
  private readonly logger = new Logger(BadgesListener.name);

  constructor(private readonly badgesService: BadgesService) {}

  @OnEvent(BadgeEvents.USER_REGISTERED, { async: true })
  onUserRegistered(event: UserRegisteredEvent) {
    return this.safely(BadgeEvents.USER_REGISTERED, () =>
      this.badgesService.evaluateUserRegistered(event.userId),
    );
  }

  @OnEvent(BadgeEvents.POST_CREATED, { async: true })
  onPostCreated(event: PostCreatedEvent) {
    return this.safely(BadgeEvents.POST_CREATED, () =>
      this.badgesService.evaluatePostCreated(event.communityProfileId),
    );
  }

  @OnEvent(BadgeEvents.REPLY_CREATED, { async: true })
  onReplyCreated(event: ReplyCreatedEvent) {
    return this.safely(BadgeEvents.REPLY_CREATED, () =>
      this.badgesService.evaluateReplyCreated(event.communityProfileId),
    );
  }

  @OnEvent(BadgeEvents.POST_UPVOTED, { async: true })
  onPostUpvoted(event: PostUpvotedEvent) {
    return this.safely(BadgeEvents.POST_UPVOTED, () =>
      this.badgesService.evaluatePostUpvoted(event.postId),
    );
  }

  @OnEvent(BadgeEvents.MEMBER_JOINED, { async: true })
  onMemberJoined(event: MemberJoinedEvent) {
    return this.safely(BadgeEvents.MEMBER_JOINED, () =>
      this.badgesService.evaluateMemberJoined(
        event.communityProfileId,
        event.communityId,
      ),
    );
  }

  @OnEvent(BadgeEvents.SELLER_APPROVED, { async: true })
  onSellerApproved(event: SellerApprovedEvent) {
    return this.safely(BadgeEvents.SELLER_APPROVED, () =>
      this.badgesService.evaluateSellerApproved(event.userId),
    );
  }

  @OnEvent(BadgeEvents.PRODUCT_PUBLISHED, { async: true })
  onProductPublished(event: ProductPublishedEvent) {
    return this.safely(BadgeEvents.PRODUCT_PUBLISHED, () =>
      this.badgesService.evaluateProductPublished(
        event.userId,
        event.communityId,
      ),
    );
  }

  @OnEvent(BadgeEvents.FAVORITE_SAVED, { async: true })
  onFavoriteSaved(event: FavoriteSavedEvent) {
    return this.safely(BadgeEvents.FAVORITE_SAVED, () =>
      this.badgesService.evaluateFavoriteSaved(
        event.userId,
        event.itemType,
        event.itemId,
      ),
    );
  }

  // REGLA CRÍTICA: un fallo evaluando badges nunca debe afectar la acción
  // principal que emitió el evento (publicar, comentar, registrarse...).
  async safely(event: string, handler: () => Promise<void>): Promise<void> {
    try {
      await handler();
    } catch (error: unknown) {
      this.logger.error(
        `Error evaluando badges para el evento ${event}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
