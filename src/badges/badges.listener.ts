import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  BadgeEvents,
  CommunityCreatedEvent,
  MemberJoinedEvent,
  ModeratorAssignedEvent,
  PostCreatedEvent,
  ProductPublishedEvent,
  ReplyCreatedEvent,
  SellerApprovedEvent,
} from './badge-events';
import { BadgesService } from './badges.service';

@Injectable()
export class BadgesListener {
  private readonly logger = new Logger(BadgesListener.name);

  constructor(private readonly badgesService: BadgesService) {}

  @OnEvent(BadgeEvents.POST_CREATED, { async: true })
  onPostCreated(event: PostCreatedEvent) {
    return this.safely(BadgeEvents.POST_CREATED, () =>
      this.badgesService.evaluatePostCreated(
        event.userId,
        event.communityProfileId,
      ),
    );
  }

  @OnEvent(BadgeEvents.REPLY_CREATED, { async: true })
  onReplyCreated(event: ReplyCreatedEvent) {
    return this.safely(BadgeEvents.REPLY_CREATED, () =>
      this.badgesService.evaluateReplyCreated(event.userId),
    );
  }

  @OnEvent(BadgeEvents.COMMUNITY_CREATED, { async: true })
  onCommunityCreated(event: CommunityCreatedEvent) {
    return this.safely(BadgeEvents.COMMUNITY_CREATED, () =>
      this.badgesService.evaluateCommunityCreated(event.communityProfileId),
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

  @OnEvent(BadgeEvents.MODERATOR_ASSIGNED, { async: true })
  onModeratorAssigned(event: ModeratorAssignedEvent) {
    return this.safely(BadgeEvents.MODERATOR_ASSIGNED, () =>
      this.badgesService.evaluateModeratorAssigned(event.communityProfileId),
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
      this.badgesService.evaluateFranchiseCollector(event.userId),
    );
  }

  // Un fallo evaluando badges nunca debe afectar a quien emitió el evento.
  private async safely(
    event: string,
    handler: () => Promise<void>,
  ): Promise<void> {
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
