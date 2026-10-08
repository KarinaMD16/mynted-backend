import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, LessThanOrEqual, Repository } from 'typeorm';
import { CommunityProfile } from '../community/entities/community-profile.entity';
import { Post } from '../community/entities/post.entity';
import { Reply } from '../community/entities/reply.entity';
import { BADGE_CODES, BADGE_THRESHOLDS } from './badges.config';
import { Badge, BadgeScope } from './entities/badge.entity';
import { CommunityProfileBadge } from './entities/community-profile-badge.entity';
import { UserBadge } from './entities/user-badge.entity';

export interface AwardedBadge {
  code: string;
  name: string;
  description: string;
  criteria: string;
  icon: string | null;
  rarity: string;
  scope: string;
  awardedAt: Date;
}

@Injectable()
export class BadgesService {
  private readonly logger = new Logger(BadgesService.name);

  constructor(
    @InjectRepository(Badge)
    private readonly badgeRepository: Repository<Badge>,
    @InjectRepository(UserBadge)
    private readonly userBadgeRepository: Repository<UserBadge>,
    @InjectRepository(CommunityProfileBadge)
    private readonly profileBadgeRepository: Repository<CommunityProfileBadge>,
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
    @InjectRepository(Reply)
    private readonly replyRepository: Repository<Reply>,
    @InjectRepository(CommunityProfile)
    private readonly communityProfileRepository: Repository<CommunityProfile>,
    private readonly dataSource: DataSource,
  ) {}

  // ---- Otorgamiento (idempotente: nunca duplica) ----

  async awardToUser(userId: string, code: string): Promise<void> {
    const badge = await this.findActiveBadge(code, BadgeScope.USER);
    if (!badge) return;

    await this.userBadgeRepository
      .createQueryBuilder()
      .insert()
      .into(UserBadge)
      .values({ userId, badgeId: badge.id })
      .orIgnore()
      .execute();
  }

  async awardToProfile(
    communityProfileId: number,
    code: string,
  ): Promise<void> {
    const badge = await this.findActiveBadge(
      code,
      BadgeScope.COMMUNITY_PROFILE,
    );
    if (!badge) return;

    await this.profileBadgeRepository
      .createQueryBuilder()
      .insert()
      .into(CommunityProfileBadge)
      .values({ communityProfileId, badgeId: badge.id })
      .orIgnore()
      .execute();
  }

  // ---- Evaluaciones por evento ----

  async evaluatePostCreated(
    userId: string,
    communityProfileId: number,
  ): Promise<void> {
    const [userPosts, profilePosts] = await Promise.all([
      this.postRepository.count({
        where: { communityProfile: { userId } },
      }),
      this.postRepository.count({ where: { communityProfileId } }),
    ]);

    if (userPosts >= 1) {
      await this.awardToUser(userId, BADGE_CODES.FIRST_POST);
    }
    if (profilePosts >= BADGE_THRESHOLDS.COMMUNITY_VOICE_MIN_POSTS) {
      await this.awardToProfile(
        communityProfileId,
        BADGE_CODES.COMMUNITY_VOICE,
      );
    }
    await this.evaluateFranchiseCollector(userId);
  }

  async evaluateReplyCreated(userId: string): Promise<void> {
    const replies = await this.replyRepository.count({
      where: { communityProfile: { userId } },
    });
    if (replies >= BADGE_THRESHOLDS.CONVERSATIONALIST_MIN_REPLIES) {
      await this.awardToUser(userId, BADGE_CODES.CONVERSATIONALIST);
    }
  }

  async evaluateCommunityCreated(communityProfileId: number): Promise<void> {
    await this.awardToProfile(
      communityProfileId,
      BADGE_CODES.COMMUNITY_FOUNDER,
    );
  }

  async evaluateMemberJoined(
    communityProfileId: number,
    communityId: number,
  ): Promise<void> {
    // Posición del perfil entre los miembros de la comunidad (por orden de
    // alta): los primeros FOUNDING_MEMBER_LIMIT son fundadores.
    const position = await this.communityProfileRepository.count({
      where: {
        communityId,
        communityProfileId: LessThanOrEqual(communityProfileId),
      },
    });
    if (position <= BADGE_THRESHOLDS.FOUNDING_MEMBER_LIMIT) {
      await this.awardToProfile(
        communityProfileId,
        BADGE_CODES.FOUNDING_MEMBER,
      );
    }
  }

  async evaluateModeratorAssigned(communityProfileId: number): Promise<void> {
    await this.awardToProfile(communityProfileId, BADGE_CODES.MODERATOR);
  }

  async evaluateSellerApproved(userId: string): Promise<void> {
    await this.awardToUser(userId, BADGE_CODES.VERIFIED_SELLER);
  }

  // Coleccionista de franquicia: posts + productos (no borradores ni
  // borrados) del usuario que comparten un mismo tag.
  async evaluateFranchiseCollector(userId: string): Promise<void> {
    const rows: unknown[] = await this.dataSource.query(
      `SELECT tag_id FROM (
         SELECT pt.tag_id
           FROM post_tag pt
           JOIN post p ON p.id = pt.post_id
           JOIN community_profile cp
             ON cp.community_profile_id = p.community_profile_id
          WHERE cp.user_id = $1
         UNION ALL
         SELECT prt.tag_id
           FROM product_tag prt
           JOIN product pr ON pr.id = prt.product_id
            AND pr.deleted_at IS NULL
            AND pr.status <> 'draft'
           JOIN seller s ON s.seller_id = pr.seller_id
          WHERE s.user_id = $1
       ) items
       GROUP BY tag_id
       HAVING COUNT(*) >= $2
       LIMIT 1`,
      [userId, BADGE_THRESHOLDS.FRANCHISE_COLLECTOR_MIN_ITEMS],
    );

    if (rows.length > 0) {
      await this.awardToUser(userId, BADGE_CODES.FRANCHISE_COLLECTOR);
    }
  }

  // Aniversario: tarea diaria que otorga el badge a las cuentas activas con
  // ANNIVERSARY_YEARS o más de antigüedad.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async awardAnniversaries(): Promise<void> {
    try {
      await this.dataSource.query(
        `INSERT INTO user_badge (user_id, badge_id)
         SELECT u.id, b.id
           FROM users u
           CROSS JOIN badge b
          WHERE b.code = $1
            AND b.is_active = true
            AND u.is_active = true
            AND u.created_at <= now() - make_interval(years => $2::int)
         ON CONFLICT DO NOTHING`,
        [BADGE_CODES.ANNIVERSARY, BADGE_THRESHOLDS.ANNIVERSARY_YEARS],
      );
    } catch (error: unknown) {
      this.logger.error(
        'No se pudieron otorgar los badges de aniversario',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  // ---- Consultas ----

  async findUserBadges(userId: string): Promise<AwardedBadge[]> {
    const rows = await this.userBadgeRepository.find({
      where: { userId },
      relations: { badge: true },
      order: { awardedAt: 'DESC', id: 'DESC' },
    });
    return rows
      .filter((row) => row.badge.isActive)
      .map((row) => this.toAwarded(row.badge, row.awardedAt));
  }

  async findProfileBadges(communityProfileId: number): Promise<AwardedBadge[]> {
    const profile = await this.communityProfileRepository.findOne({
      where: { communityProfileId },
      select: { communityProfileId: true },
    });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    const rows = await this.profileBadgeRepository.find({
      where: { communityProfileId },
      relations: { badge: true },
      order: { awardedAt: 'DESC', id: 'DESC' },
    });
    return rows
      .filter((row) => row.badge.isActive)
      .map((row) => this.toAwarded(row.badge, row.awardedAt));
  }

  private findActiveBadge(code: string, scope: BadgeScope) {
    return this.badgeRepository.findOne({
      where: { code, scope, isActive: true },
    });
  }

  private toAwarded(badge: Badge, awardedAt: Date): AwardedBadge {
    return {
      code: badge.code,
      name: badge.name,
      description: badge.description,
      criteria: badge.criteria,
      icon: badge.icon,
      rarity: badge.rarity,
      scope: badge.scope,
      awardedAt,
    };
  }
}
