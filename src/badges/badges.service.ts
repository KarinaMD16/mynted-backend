import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { ProStatusService } from '../pro-status/pro-status.service';
import { CommunityProfile } from '../community/entities/community-profile.entity';
import { CommunityProfileRole } from '../community/entities/community-profile.entity';
import { BadgeAwardedEvent, BadgeAwardEvents } from './badge-events';
import { BADGE_CODES, DERIVED_BADGE_CODES } from './badges.config';
import { Badge, BadgeRarity, BadgeScope } from './entities/badge.entity';
import { CommunityProfileBadge } from './entities/community-profile-badge.entity';
import { UserBadge } from './entities/user-badge.entity';

// Forma exacta que consume el frontend.
export interface BadgeItem {
  code: string;
  name: string;
  description: string;
  scope: BadgeScope;
  rarity: BadgeRarity;
  awardedAt: Date | null;
  derived: boolean;
}

export type BackfillResult = Record<string, number>;

const RARITY_ORDER: Record<BadgeRarity, number> = {
  [BadgeRarity.LEGENDARY]: 5,
  [BadgeRarity.EPIC]: 4,
  [BadgeRarity.RARE]: 3,
  [BadgeRarity.UNCOMMON]: 2,
  [BadgeRarity.COMMON]: 1,
};

const ANNIVERSARY_BATCH_SIZE = 500;
const ANNIVERSARY_MAX_BATCHES = 1000;

interface PostgresError {
  code?: string;
}

// Se lanza al intentar otorgar un badge a la tabla equivocada o uno derivado.
export class BadgeAwardError extends Error {}

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
    @InjectRepository(CommunityProfile)
    private readonly communityProfileRepository: Repository<CommunityProfile>,
    private readonly dataSource: DataSource,
    private readonly proStatusService: ProStatusService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------
  // Otorgamiento (idempotente: nunca duplica ni falla si ya lo tiene)
  // ---------------------------------------------------------------------

  async awardToUser(userId: string, code: string): Promise<boolean> {
    const badge = await this.getAwardableBadge(code, BadgeScope.USER);
    if (!badge) return false;

    try {
      const result = await this.userBadgeRepository
        .createQueryBuilder()
        .insert()
        .into(UserBadge)
        .values({ userId, badgeId: badge.id })
        .orIgnore()
        .execute();
      const awarded = (result.identifiers?.length ?? 0) > 0;
      if (awarded) this.emitAwarded(badge, userId, null, null);
      return awarded;
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async awardToCommunityProfile(
    communityProfileId: number,
    code: string,
  ): Promise<boolean> {
    const badge = await this.getAwardableBadge(code, BadgeScope.COMMUNITY);
    if (!badge) return false;

    try {
      const result = await this.profileBadgeRepository
        .createQueryBuilder()
        .insert()
        .into(CommunityProfileBadge)
        .values({ communityProfileId, badgeId: badge.id })
        .orIgnore()
        .execute();
      const awarded = (result.identifiers?.length ?? 0) > 0;
      if (awarded) {
        const profile = await this.communityProfileRepository.findOne({
          where: { communityProfileId },
          select: { communityProfileId: true, userId: true, communityId: true },
        });
        if (profile) {
          this.emitAwarded(
            badge,
            profile.userId,
            communityProfileId,
            profile.communityId,
          );
        }
      }
      return awarded;
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) return false;
      throw error;
    }
  }

  private emitAwarded(
    badge: Badge,
    userId: string,
    communityProfileId: number | null,
    communityId: number | null,
  ): void {
    const event: BadgeAwardedEvent = {
      userId,
      badgeCode: badge.code,
      badgeName: badge.name,
      rarity: badge.rarity,
      scope: badge.scope,
      communityProfileId,
      communityId,
    };
    this.eventEmitter?.emit(BadgeAwardEvents.AWARDED, event);
  }

  // Devuelve null si el badge está inactivo (no se otorga). Lanza si el badge
  // no existe, es derivado o su scope no corresponde a la tabla destino.
  private async getAwardableBadge(
    code: string,
    expectedScope: BadgeScope,
  ): Promise<Badge | null> {
    const badge = await this.badgeRepository.findOne({ where: { code } });
    if (!badge) throw new BadgeAwardError(`El badge "${code}" no existe`);
    if (DERIVED_BADGE_CODES.has(code)) {
      throw new BadgeAwardError(
        `El badge "${code}" es derivado del rol y no se otorga`,
      );
    }
    if (badge.scope !== expectedScope) {
      throw new BadgeAwardError(
        `El badge "${code}" tiene scope "${badge.scope}" y no puede otorgarse con scope "${expectedScope}"`,
      );
    }
    return badge.isActive ? badge : null;
  }

  // ---------------------------------------------------------------------
  // Evaluadores por evento (leen el threshold del badge)
  // ---------------------------------------------------------------------

  // first_post: primera publicación del perfil en la comunidad.
  async evaluatePostCreated(communityProfileId: number): Promise<void> {
    await this.evaluateProfileCount(
      BADGE_CODES.FIRST_POST,
      communityProfileId,
      'SELECT COUNT(*)::int AS value FROM post WHERE community_profile_id = $1',
    );
  }

  // talkative: replies del perfil en la comunidad.
  async evaluateReplyCreated(communityProfileId: number): Promise<void> {
    await this.evaluateProfileCount(
      BADGE_CODES.TALKATIVE,
      communityProfileId,
      'SELECT COUNT(*)::int AS value FROM reply WHERE community_profile_id = $1',
    );
  }

  // community_voice: upvotes acumulados en los posts del perfil.
  async evaluatePostUpvoted(postId: number): Promise<void> {
    const rows = await this.dataSource.query<
      { community_profile_id: number }[]
    >('SELECT community_profile_id FROM post WHERE id = $1', [postId]);
    if (rows.length === 0) return;

    await this.evaluateProfileCount(
      BADGE_CODES.COMMUNITY_VOICE,
      rows[0].community_profile_id,
      `SELECT COUNT(*)::int AS value
         FROM post_vote v JOIN post p ON p.id = v.post_id
        WHERE p.community_profile_id = $1 AND v."voteType" = 'UP'`,
    );
  }

  // founding_member: entre los primeros N usuarios registrados (por orden de
  // creación; desempate por id).
  async evaluateUserRegistered(userId: string): Promise<void> {
    const badge = await this.getThreshold(BADGE_CODES.FOUNDING_MEMBER);
    if (!badge) return;

    const rows = await this.dataSource.query<{ value: number }[]>(
      `SELECT COUNT(*)::int AS value
         FROM users u
        WHERE (u.created_at, u.id) <=
              (SELECT created_at, id FROM users WHERE id = $1)`,
      [userId],
    );
    if ((rows[0]?.value ?? Infinity) <= badge.threshold) {
      await this.awardToUser(userId, BADGE_CODES.FOUNDING_MEMBER);
    }
  }

  // community_founding_member: entre los primeros N miembros de la comunidad
  // (por orden de creación del communityProfile).
  async evaluateMemberJoined(
    communityProfileId: number,
    communityId: number,
  ): Promise<void> {
    const badge = await this.getThreshold(
      BADGE_CODES.COMMUNITY_FOUNDING_MEMBER,
    );
    if (!badge) return;

    const rows = await this.dataSource.query<{ value: number }[]>(
      `SELECT COUNT(*)::int AS value
         FROM community_profile
        WHERE community_id = $1 AND community_profile_id <= $2`,
      [communityId, communityProfileId],
    );
    if ((rows[0]?.value ?? Infinity) <= badge.threshold) {
      await this.awardToCommunityProfile(
        communityProfileId,
        BADGE_CODES.COMMUNITY_FOUNDING_MEMBER,
      );
    }
  }

  // verified_seller: la solicitud de vendedor pasó a approved.
  async evaluateSellerApproved(userId: string): Promise<void> {
    await this.awardToUser(userId, BADGE_CODES.VERIFIED_SELLER);
  }

  // community_collector (por publicar un producto en una comunidad).
  async evaluateProductPublished(
    userId: string,
    communityId: number | null,
  ): Promise<void> {
    if (communityId === null) return;
    await this.evaluateCollectorFor(userId, communityId);
  }

  // community_collector (por guardar un favorito de un post o producto).
  async evaluateFavoriteSaved(
    userId: string,
    itemType: 'POST' | 'PRODUCT' | 'REPLY',
    itemId: number,
  ): Promise<void> {
    let rows: { community_id: number | null }[] = [];
    if (itemType === 'POST') {
      rows = await this.dataSource.query(
        `SELECT cp.community_id
           FROM post p JOIN community_profile cp
             ON cp.community_profile_id = p.community_profile_id
          WHERE p.id = $1`,
        [itemId],
      );
    } else if (itemType === 'PRODUCT') {
      rows = await this.dataSource.query(
        'SELECT community_id FROM product WHERE id = $1',
        [itemId],
      );
    }
    const communityId = rows[0]?.community_id;
    if (communityId == null) return;
    await this.evaluateCollectorFor(userId, communityId);
  }

  private async evaluateCollectorFor(
    userId: string,
    communityId: number,
  ): Promise<void> {
    const badge = await this.getThreshold(BADGE_CODES.COMMUNITY_COLLECTOR);
    if (!badge) return;

    const profile = await this.communityProfileRepository.findOne({
      where: { userId, communityId },
      select: { communityProfileId: true },
    });
    if (!profile) return;

    // Productos publicados por el usuario en la comunidad (sin borradores ni
    // borrados) + favoritos suyos sobre posts o productos de la comunidad.
    const rows = await this.dataSource.query<{ value: number }[]>(
      `SELECT (
         (SELECT COUNT(*) FROM product pr
            JOIN seller s ON s.seller_id = pr.seller_id
           WHERE s.user_id = $1 AND pr.community_id = $2
             AND pr.deleted_at IS NULL AND pr.status <> 'draft')
       + (SELECT COUNT(*) FROM favorite f
            JOIN post p ON p.id = f.item_id
            JOIN community_profile cp
              ON cp.community_profile_id = p.community_profile_id
           WHERE f.user_id = $1 AND f."itemType" = 'POST'
             AND cp.community_id = $2)
       + (SELECT COUNT(*) FROM favorite f
            JOIN product pr ON pr.id = f.item_id AND pr.deleted_at IS NULL
           WHERE f.user_id = $1 AND f."itemType" = 'PRODUCT'
             AND pr.community_id = $2)
       )::int AS value`,
      [userId, communityId],
    );
    if ((rows[0]?.value ?? 0) >= badge.threshold) {
      await this.awardToCommunityProfile(
        profile.communityProfileId,
        BADGE_CODES.COMMUNITY_COLLECTOR,
      );
    }
  }

  // Evalúa un badge de scope community que compara un conteo contra threshold.
  private async evaluateProfileCount(
    code: string,
    communityProfileId: number,
    countSql: string,
  ): Promise<void> {
    const badge = await this.getThreshold(code);
    if (!badge) return;

    const rows = await this.dataSource.query<{ value: number }[]>(countSql, [
      communityProfileId,
    ]);
    if ((rows[0]?.value ?? 0) >= badge.threshold) {
      await this.awardToCommunityProfile(communityProfileId, code);
    }
  }

  // Badge activo con threshold definido (null si no hay que evaluar).
  private async getThreshold(
    code: string,
  ): Promise<{ threshold: number } | null> {
    const badge = await this.badgeRepository.findOne({ where: { code } });
    if (!badge?.isActive || badge.threshold === null) return null;
    return { threshold: badge.threshold };
  }

  // ---------------------------------------------------------------------
  // Aniversario (cron diario) y backfill
  // ---------------------------------------------------------------------

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runAnniversaryCron(): Promise<void> {
    try {
      const awarded = await this.awardAnniversaries();
      if (awarded > 0) {
        this.logger.log(`Badges de aniversario otorgados: ${awarded}`);
      }
    } catch (error: unknown) {
      this.logger.error(
        'No se pudieron otorgar los badges de aniversario',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  // Usuarios activos con threshold días o más de antigüedad que aún no tienen
  // el badge. Se procesa en lotes; es idempotente.
  async awardAnniversaries(): Promise<number> {
    const row = await this.badgeRepository.findOne({
      where: { code: BADGE_CODES.ANNIVERSARY },
    });
    if (!row?.isActive || row.threshold === null) return 0;

    let total = 0;
    for (let batch = 0; batch < ANNIVERSARY_MAX_BATCHES; batch++) {
      const rows = await this.dataSource.query<{ count: number }[]>(
        `WITH batch AS (
           SELECT u.id FROM users u
            WHERE u.is_active = true
              AND u.created_at <= now() - make_interval(days => $2::int)
              AND NOT EXISTS (
                SELECT 1 FROM user_badge ub
                 WHERE ub.user_id = u.id AND ub.badge_id = $1)
            ORDER BY u.created_at
            LIMIT $3
         ), ins AS (
           INSERT INTO user_badge (user_id, badge_id)
           SELECT id, $1 FROM batch
           ON CONFLICT DO NOTHING
           RETURNING 1
         )
         SELECT COUNT(*)::int AS count FROM ins`,
        [row.id, row.threshold, ANNIVERSARY_BATCH_SIZE],
      );
      const inserted = rows[0]?.count ?? 0;
      total += inserted;
      if (inserted < ANNIVERSARY_BATCH_SIZE) break;
    }
    return total;
  }

  // Evalúa los datos ya existentes y otorga retroactivamente los badges que
  // correspondan. Idempotente: solo inserta lo que falta. Devuelve cuántos
  // badges nuevos se otorgaron por code.
  async backfill(): Promise<BackfillResult> {
    const result: BackfillResult = {};
    const badges = await this.badgeRepository.find({
      where: { isActive: true },
    });
    const byCode = new Map(badges.map((badge) => [badge.code, badge]));

    const run = async (
      code: string,
      table: 'user_badge' | 'community_profile_badge',
      targetColumn: 'user_id' | 'community_profile_id',
      selectSql: string,
    ) => {
      const badge = byCode.get(code);
      if (!badge || (selectSql.includes('$2') && badge.threshold === null)) {
        result[code] = 0;
        return;
      }
      const params: unknown[] = [badge.id];
      if (selectSql.includes('$2')) params.push(badge.threshold);
      const rows = await this.dataSource.query<{ count: number }[]>(
        `WITH ins AS (
           INSERT INTO ${table} (${targetColumn}, badge_id)
           ${selectSql}
           ON CONFLICT DO NOTHING
           RETURNING 1
         ) SELECT COUNT(*)::int AS count FROM ins`,
        params,
      );
      result[code] = rows[0]?.count ?? 0;
    };

    // user
    await run(
      BADGE_CODES.VERIFIED_SELLER,
      'user_badge',
      'user_id',
      `SELECT u.id, $1::int FROM users u
        WHERE u.role = 'seller' AND u.seller_request_status = 'approved'`,
    );
    await run(
      BADGE_CODES.FOUNDING_MEMBER,
      'user_badge',
      'user_id',
      `SELECT ranked.id, $1::int
         FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
                 FROM users) ranked
        WHERE ranked.rn <= $2::int`,
    );
    await run(
      BADGE_CODES.ANNIVERSARY,
      'user_badge',
      'user_id',
      `SELECT u.id, $1::int FROM users u
        WHERE u.is_active = true
          AND u.created_at <= now() - make_interval(days => $2::int)`,
    );
    // community
    await run(
      BADGE_CODES.FIRST_POST,
      'community_profile_badge',
      'community_profile_id',
      `SELECT p.community_profile_id, $1::int FROM post p
        GROUP BY p.community_profile_id HAVING COUNT(*) >= $2::int`,
    );
    await run(
      BADGE_CODES.TALKATIVE,
      'community_profile_badge',
      'community_profile_id',
      `SELECT r.community_profile_id, $1::int FROM reply r
        GROUP BY r.community_profile_id HAVING COUNT(*) >= $2::int`,
    );
    await run(
      BADGE_CODES.COMMUNITY_VOICE,
      'community_profile_badge',
      'community_profile_id',
      `SELECT p.community_profile_id, $1::int
         FROM post_vote v JOIN post p ON p.id = v.post_id
        WHERE v."voteType" = 'UP'
        GROUP BY p.community_profile_id HAVING COUNT(*) >= $2::int`,
    );
    await run(
      BADGE_CODES.COMMUNITY_COLLECTOR,
      'community_profile_badge',
      'community_profile_id',
      `SELECT cp.community_profile_id, $1::int
         FROM community_profile cp
        WHERE (
          (SELECT COUNT(*) FROM product pr
             JOIN seller s ON s.seller_id = pr.seller_id
            WHERE s.user_id = cp.user_id AND pr.community_id = cp.community_id
              AND pr.deleted_at IS NULL AND pr.status <> 'draft')
        + (SELECT COUNT(*) FROM favorite f
             JOIN post p ON p.id = f.item_id
             JOIN community_profile pcp
               ON pcp.community_profile_id = p.community_profile_id
            WHERE f.user_id = cp.user_id AND f."itemType" = 'POST'
              AND pcp.community_id = cp.community_id)
        + (SELECT COUNT(*) FROM favorite f
             JOIN product pr ON pr.id = f.item_id AND pr.deleted_at IS NULL
            WHERE f.user_id = cp.user_id AND f."itemType" = 'PRODUCT'
              AND pr.community_id = cp.community_id)
        ) >= $2::int`,
    );
    await run(
      BADGE_CODES.COMMUNITY_FOUNDING_MEMBER,
      'community_profile_badge',
      'community_profile_id',
      `SELECT ranked.community_profile_id, $1::int
         FROM (SELECT community_profile_id,
                      ROW_NUMBER() OVER (
                        PARTITION BY community_id ORDER BY community_profile_id
                      ) AS rn
                 FROM community_profile) ranked
        WHERE ranked.rn <= $2::int`,
    );

    return result;
  }

  // ---------------------------------------------------------------------
  // Consultas
  // ---------------------------------------------------------------------

  // Catálogo activo (para que el front pinte también los badges bloqueados).
  async findCatalog(scope?: BadgeScope): Promise<BadgeItem[]> {
    const badges = await this.badgeRepository.find({
      where: { isActive: true, ...(scope ? { scope } : {}) },
    });
    return this.sort(
      badges.map((badge) =>
        this.toItem(badge, null, DERIVED_BADGE_CODES.has(badge.code)),
      ),
    );
  }

  // Badges ganados + el derivado pro (derived: true y awardedAt: null) mientras
  // la suscripción Pro esté vigente.
  async findUserBadges(userId: string): Promise<BadgeItem[]> {
    const [rows, isPro] = await Promise.all([
      this.userBadgeRepository.find({
        where: { userId },
        relations: { badge: true },
      }),
      this.proStatusService.isPro(userId),
    ]);
    const items = rows
      .filter((row) => row.badge.isActive)
      .map((row) => this.toItem(row.badge, row.awardedAt, false));

    if (isPro) {
      const proBadge = await this.badgeRepository.findOne({
        where: { code: BADGE_CODES.PRO, isActive: true },
      });
      if (proBadge) items.push(this.toItem(proBadge, null, true));
    }
    return this.sort(items);
  }

  // Badges ganados + derivados del rol (community_founder / moderator, con
  // derived: true y awardedAt: null). En comunidades privadas solo los
  // miembros pueden verlos.
  async findCommunityProfileBadges(
    communityProfileId: number,
    viewerId: string,
  ): Promise<BadgeItem[]> {
    const profile = await this.communityProfileRepository.findOne({
      where: { communityProfileId },
      relations: { community: true },
    });
    if (!profile?.community?.isActive) {
      throw new NotFoundException('Perfil no encontrado');
    }

    if (profile.community.isPrivate) {
      const viewerProfile = await this.communityProfileRepository.findOne({
        where: { userId: viewerId, communityId: profile.communityId },
        select: { communityProfileId: true },
      });
      if (!viewerProfile) {
        throw new ForbiddenException('Debes pertenecer a la comunidad');
      }
    }

    const rows = await this.profileBadgeRepository.find({
      where: { communityProfileId },
      relations: { badge: true },
    });
    const items = rows
      .filter((row) => row.badge.isActive)
      .map((row) => this.toItem(row.badge, row.awardedAt, false));

    const derivedCode =
      profile.role === CommunityProfileRole.OWNER
        ? BADGE_CODES.COMMUNITY_FOUNDER
        : profile.role === CommunityProfileRole.MODERATOR
          ? BADGE_CODES.MODERATOR
          : null;
    if (derivedCode) {
      const badge = await this.badgeRepository.findOne({
        where: { code: derivedCode, isActive: true },
      });
      if (badge) items.push(this.toItem(badge, null, true));
    }

    return this.sort(items);
  }

  private toItem(
    badge: Badge,
    awardedAt: Date | null,
    derived: boolean,
  ): BadgeItem {
    return {
      code: badge.code,
      name: badge.name,
      description: badge.description,
      scope: badge.scope,
      rarity: badge.rarity,
      awardedAt,
      derived,
    };
  }

  // Rareza descendente (legendary primero) y luego awardedAt descendente
  // (los derivados, sin fecha, al final de su rareza).
  private sort(items: BadgeItem[]): BadgeItem[] {
    return [...items].sort(
      (a, b) =>
        RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity] ||
        (b.awardedAt?.getTime() ?? 0) - (a.awardedAt?.getTime() ?? 0),
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as PostgresError).code === '23505'
    );
  }
}
