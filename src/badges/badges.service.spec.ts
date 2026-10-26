import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import {
  CommunityProfile,
  CommunityProfileRole,
} from '../community/entities/community-profile.entity';
import { BadgeEvents } from './badge-events';
import { BADGE_CODES } from './badges.config';
import { BadgesListener } from './badges.listener';
import { BadgeAwardError, BadgesService } from './badges.service';
import { Badge, BadgeRarity, BadgeScope } from './entities/badge.entity';
import { CommunityProfileBadge } from './entities/community-profile-badge.entity';
import { UserBadge } from './entities/user-badge.entity';

/* eslint-disable @typescript-eslint/no-unsafe-member-access */

describe('BadgesService', () => {
  const badge = (overrides: Partial<Badge> = {}): Badge => ({
    id: 1,
    code: BADGE_CODES.TALKATIVE,
    name: 'Conversador',
    description: 'desc',
    scope: BadgeScope.COMMUNITY,
    rarity: BadgeRarity.UNCOMMON,
    metric: null,
    threshold: 25,
    isActive: true,
    ...overrides,
  });

  const insertBuilder = () => {
    const builder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ identifiers: [{ id: 1 }] }),
    };
    return builder;
  };

  const setup = () => {
    const badgeRepository = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };
    const userBadgeRepository = {
      createQueryBuilder: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };
    const profileBadgeRepository = {
      createQueryBuilder: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };
    const communityProfileRepository = { findOne: jest.fn() };
    const dataSource = { query: jest.fn() };
    const proStatusService = { isPro: jest.fn().mockResolvedValue(false) };
    const userInsert = insertBuilder();
    const profileInsert = insertBuilder();
    userBadgeRepository.createQueryBuilder.mockReturnValue(userInsert);
    profileBadgeRepository.createQueryBuilder.mockReturnValue(profileInsert);

    const service = new BadgesService(
      badgeRepository as unknown as Repository<Badge>,
      userBadgeRepository as unknown as Repository<UserBadge>,
      profileBadgeRepository as unknown as Repository<CommunityProfileBadge>,
      communityProfileRepository as unknown as Repository<CommunityProfile>,
      dataSource as never,
      proStatusService as never,
    );
    return {
      service,
      badgeRepository,
      userBadgeRepository,
      profileBadgeRepository,
      communityProfileRepository,
      dataSource,
      proStatusService,
      userInsert,
      profileInsert,
    };
  };

  describe('awarding', () => {
    it('awards a user badge with an idempotent insert', async () => {
      const ctx = setup();
      ctx.badgeRepository.findOne.mockResolvedValue(
        badge({ code: BADGE_CODES.VERIFIED_SELLER, scope: BadgeScope.USER }),
      );

      const awarded = await ctx.service.awardToUser(
        'user-id',
        BADGE_CODES.VERIFIED_SELLER,
      );

      expect(awarded).toBe(true);
      expect(ctx.userInsert.values).toHaveBeenCalledWith({
        userId: 'user-id',
        badgeId: 1,
      });
      expect(ctx.userInsert.orIgnore).toHaveBeenCalled();
    });

    it('does nothing and does not fail when the user already has the badge', async () => {
      const ctx = setup();
      ctx.badgeRepository.findOne.mockResolvedValue(
        badge({ code: BADGE_CODES.VERIFIED_SELLER, scope: BadgeScope.USER }),
      );
      ctx.userInsert.execute.mockResolvedValue({ identifiers: [] });

      await expect(
        ctx.service.awardToUser('user-id', BADGE_CODES.VERIFIED_SELLER),
      ).resolves.toBe(false);
    });

    it('swallows a unique violation (23505) from a concurrent award', async () => {
      const ctx = setup();
      ctx.badgeRepository.findOne.mockResolvedValue(
        badge({ scope: BadgeScope.COMMUNITY }),
      );
      const error = new QueryFailedError('insert', [], {
        code: '23505',
      } as never);
      ctx.profileInsert.execute.mockRejectedValue(error);

      await expect(
        ctx.service.awardToCommunityProfile(5, BADGE_CODES.TALKATIVE),
      ).resolves.toBe(false);
    });

    it('rejects awarding a community badge to a user (scope mismatch)', async () => {
      const ctx = setup();
      ctx.badgeRepository.findOne.mockResolvedValue(
        badge({ scope: BadgeScope.COMMUNITY }),
      );

      await expect(
        ctx.service.awardToUser('user-id', BADGE_CODES.TALKATIVE),
      ).rejects.toBeInstanceOf(BadgeAwardError);
      expect(ctx.userBadgeRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('rejects awarding a user badge to a communityProfile (scope mismatch)', async () => {
      const ctx = setup();
      ctx.badgeRepository.findOne.mockResolvedValue(
        badge({ code: BADGE_CODES.ANNIVERSARY, scope: BadgeScope.USER }),
      );

      await expect(
        ctx.service.awardToCommunityProfile(5, BADGE_CODES.ANNIVERSARY),
      ).rejects.toBeInstanceOf(BadgeAwardError);
    });

    it('never stores derived badges (community_founder / moderator)', async () => {
      const ctx = setup();
      ctx.badgeRepository.findOne.mockResolvedValue(
        badge({
          code: BADGE_CODES.MODERATOR,
          scope: BadgeScope.COMMUNITY,
          threshold: null,
        }),
      );

      await expect(
        ctx.service.awardToCommunityProfile(5, BADGE_CODES.MODERATOR),
      ).rejects.toBeInstanceOf(BadgeAwardError);
      expect(
        ctx.profileBadgeRepository.createQueryBuilder,
      ).not.toHaveBeenCalled();
    });

    it('skips inactive badges', async () => {
      const ctx = setup();
      ctx.badgeRepository.findOne.mockResolvedValue(
        badge({ scope: BadgeScope.COMMUNITY, isActive: false }),
      );

      await expect(
        ctx.service.awardToCommunityProfile(5, BADGE_CODES.TALKATIVE),
      ).resolves.toBe(false);
      expect(
        ctx.profileBadgeRepository.createQueryBuilder,
      ).not.toHaveBeenCalled();
    });
  });

  describe('badge.awarded', () => {
    const withEvents = () => {
      const ctx = setup();
      const emit = jest.fn();
      const service = new BadgesService(
        ctx.badgeRepository as unknown as Repository<Badge>,
        ctx.userBadgeRepository as unknown as Repository<UserBadge>,
        ctx.profileBadgeRepository as unknown as Repository<CommunityProfileBadge>,
        ctx.communityProfileRepository as unknown as Repository<CommunityProfile>,
        ctx.dataSource as never,
        ctx.proStatusService as never,
        { emit } as never,
      );
      return { ...ctx, service, emit };
    };

    it('se emite solo cuando el badge se inserta de verdad', async () => {
      const ctx = withEvents();
      ctx.badgeRepository.findOne.mockResolvedValue(
        badge({
          code: BADGE_CODES.VERIFIED_SELLER,
          name: 'Vendedor verificado',
          scope: BadgeScope.USER,
          rarity: BadgeRarity.RARE,
        }),
      );

      await ctx.service.awardToUser('user-id', BADGE_CODES.VERIFIED_SELLER);
      expect(ctx.emit).toHaveBeenCalledWith('badge.awarded', {
        userId: 'user-id',
        badgeCode: BADGE_CODES.VERIFIED_SELLER,
        badgeName: 'Vendedor verificado',
        rarity: BadgeRarity.RARE,
        scope: BadgeScope.USER,
        communityProfileId: null,
        communityId: null,
      });

      ctx.emit.mockClear();
      ctx.userInsert.execute.mockResolvedValue({ identifiers: [] });
      await ctx.service.awardToUser('user-id', BADGE_CODES.VERIFIED_SELLER);
      expect(ctx.emit).not.toHaveBeenCalled();
    });

    it('en badges de comunidad resuelve el usuario y la comunidad del perfil', async () => {
      const ctx = withEvents();
      ctx.badgeRepository.findOne.mockResolvedValue(badge());
      ctx.communityProfileRepository.findOne.mockResolvedValue({
        communityProfileId: 9,
        userId: 'owner-id',
        communityId: 3,
      });

      await ctx.service.awardToCommunityProfile(9, BADGE_CODES.TALKATIVE);

      expect(ctx.emit).toHaveBeenCalledWith(
        'badge.awarded',
        expect.objectContaining({
          userId: 'owner-id',
          badgeCode: BADGE_CODES.TALKATIVE,
          communityProfileId: 9,
          communityId: 3,
        }),
      );
    });

    it('el cron de aniversario no emite (inserta en lote por SQL)', async () => {
      const ctx = withEvents();
      ctx.badgeRepository.findOne.mockResolvedValue(
        badge({ code: BADGE_CODES.ANNIVERSARY, threshold: 365 }),
      );
      ctx.dataSource.query.mockResolvedValue([{ count: 3 }]);

      await ctx.service.awardAnniversaries();

      expect(ctx.emit).not.toHaveBeenCalled();
    });
  });

  describe('threshold evaluation', () => {
    it('does not award talkative below the threshold read from the badge', async () => {
      const ctx = setup();
      ctx.badgeRepository.findOne.mockResolvedValue(badge({ threshold: 25 }));
      ctx.dataSource.query.mockResolvedValue([{ value: 24 }]);

      await ctx.service.evaluateReplyCreated(5);

      expect(ctx.profileInsert.execute).not.toHaveBeenCalled();
    });

    it('awards talkative when the replies reach the threshold', async () => {
      const ctx = setup();
      ctx.badgeRepository.findOne.mockResolvedValue(badge({ threshold: 25 }));
      ctx.dataSource.query.mockResolvedValue([{ value: 25 }]);

      await ctx.service.evaluateReplyCreated(5);

      expect(ctx.profileInsert.values).toHaveBeenCalledWith({
        communityProfileId: 5,
        badgeId: 1,
      });
    });

    it('uses an adjusted threshold without code changes', async () => {
      const ctx = setup();
      ctx.badgeRepository.findOne.mockResolvedValue(badge({ threshold: 3 }));
      ctx.dataSource.query.mockResolvedValue([{ value: 3 }]);

      await ctx.service.evaluateReplyCreated(5);

      expect(ctx.profileInsert.execute).toHaveBeenCalled();
    });

    it('awards first_post with the first post of the profile', async () => {
      const ctx = setup();
      ctx.badgeRepository.findOne.mockResolvedValue(
        badge({ code: BADGE_CODES.FIRST_POST, threshold: 1 }),
      );
      ctx.dataSource.query.mockResolvedValue([{ value: 1 }]);

      await ctx.service.evaluatePostCreated(5);

      expect(ctx.profileInsert.execute).toHaveBeenCalled();
    });

    it('awards founding_member only within the first N registered users', async () => {
      const ctx = setup();
      ctx.badgeRepository.findOne.mockResolvedValue(
        badge({
          code: BADGE_CODES.FOUNDING_MEMBER,
          scope: BadgeScope.USER,
          threshold: 100,
        }),
      );

      ctx.dataSource.query.mockResolvedValueOnce([{ value: 101 }]);
      await ctx.service.evaluateUserRegistered('user-id');
      expect(ctx.userInsert.execute).not.toHaveBeenCalled();

      ctx.dataSource.query.mockResolvedValueOnce([{ value: 100 }]);
      await ctx.service.evaluateUserRegistered('user-id');
      expect(ctx.userInsert.execute).toHaveBeenCalledTimes(1);
    });

    it('awards community_founding_member within the first members of the community', async () => {
      const ctx = setup();
      ctx.badgeRepository.findOne.mockResolvedValue(
        badge({
          code: BADGE_CODES.COMMUNITY_FOUNDING_MEMBER,
          threshold: 25,
        }),
      );

      ctx.dataSource.query.mockResolvedValueOnce([{ value: 26 }]);
      await ctx.service.evaluateMemberJoined(9, 3);
      expect(ctx.profileInsert.execute).not.toHaveBeenCalled();

      ctx.dataSource.query.mockResolvedValueOnce([{ value: 25 }]);
      await ctx.service.evaluateMemberJoined(9, 3);
      expect(ctx.profileInsert.execute).toHaveBeenCalledTimes(1);
    });

    it('evaluates community_collector only with a profile in the community', async () => {
      const ctx = setup();
      ctx.badgeRepository.findOne.mockResolvedValue(
        badge({ code: BADGE_CODES.COMMUNITY_COLLECTOR, threshold: 10 }),
      );

      ctx.communityProfileRepository.findOne.mockResolvedValueOnce(null);
      await ctx.service.evaluateProductPublished('user-id', 3);
      expect(ctx.dataSource.query).not.toHaveBeenCalled();

      ctx.communityProfileRepository.findOne.mockResolvedValue({
        communityProfileId: 9,
      });
      ctx.dataSource.query.mockResolvedValue([{ value: 10 }]);
      await ctx.service.evaluateProductPublished('user-id', 3);
      expect(ctx.profileInsert.values).toHaveBeenCalledWith({
        communityProfileId: 9,
        badgeId: 1,
      });
    });

    it('ignores products published without a community', async () => {
      const ctx = setup();

      await ctx.service.evaluateProductPublished('user-id', null);

      expect(ctx.badgeRepository.findOne).not.toHaveBeenCalled();
    });

    it('resolves the community of a saved favorite before evaluating the collector', async () => {
      const ctx = setup();
      ctx.badgeRepository.findOne.mockResolvedValue(
        badge({ code: BADGE_CODES.COMMUNITY_COLLECTOR, threshold: 2 }),
      );
      ctx.communityProfileRepository.findOne.mockResolvedValue({
        communityProfileId: 9,
      });
      ctx.dataSource.query
        .mockResolvedValueOnce([{ community_id: 3 }])
        .mockResolvedValueOnce([{ value: 2 }]);

      await ctx.service.evaluateFavoriteSaved('user-id', 'PRODUCT', 77);

      expect(ctx.profileInsert.execute).toHaveBeenCalled();
    });
  });

  describe('queries', () => {
    const profile = (role: CommunityProfileRole, isPrivate = false) => ({
      communityProfileId: 5,
      communityId: 3,
      role,
      community: { isActive: true, isPrivate },
    });

    it('adds the derived badge for an owner with derived: true and no date', async () => {
      const ctx = setup();
      ctx.communityProfileRepository.findOne.mockResolvedValue(
        profile(CommunityProfileRole.OWNER),
      );
      ctx.profileBadgeRepository.find.mockResolvedValue([
        {
          awardedAt: new Date('2026-01-01'),
          badge: badge({
            code: BADGE_CODES.FIRST_POST,
            rarity: BadgeRarity.COMMON,
          }),
        },
      ]);
      ctx.badgeRepository.findOne.mockResolvedValue(
        badge({
          code: BADGE_CODES.COMMUNITY_FOUNDER,
          rarity: BadgeRarity.EPIC,
          threshold: null,
        }),
      );

      const items = await ctx.service.findCommunityProfileBadges(5, 'viewer');

      expect(items.map((item) => item.code)).toEqual([
        BADGE_CODES.COMMUNITY_FOUNDER,
        BADGE_CODES.FIRST_POST,
      ]);
      expect(items[0]).toMatchObject({ derived: true, awardedAt: null });
      expect(items[1]).toMatchObject({ derived: false });
    });

    it('does not add a derived badge for a regular member', async () => {
      const ctx = setup();
      ctx.communityProfileRepository.findOne.mockResolvedValue(
        profile(CommunityProfileRole.MEMBER),
      );

      const items = await ctx.service.findCommunityProfileBadges(5, 'viewer');

      expect(items).toEqual([]);
      expect(ctx.badgeRepository.findOne).not.toHaveBeenCalled();
    });

    it('orders by rarity descending and then awardedAt descending', async () => {
      const ctx = setup();
      ctx.userBadgeRepository.find.mockResolvedValue([
        {
          awardedAt: new Date('2026-03-01'),
          badge: badge({ code: 'a', rarity: BadgeRarity.RARE }),
        },
        {
          awardedAt: new Date('2026-01-01'),
          badge: badge({ code: 'b', rarity: BadgeRarity.LEGENDARY }),
        },
        {
          awardedAt: new Date('2026-05-01'),
          badge: badge({ code: 'c', rarity: BadgeRarity.RARE }),
        },
      ]);

      const items = await ctx.service.findUserBadges('user-id');

      expect(items.map((item) => item.code)).toEqual(['b', 'c', 'a']);
    });

    it('hides a private community profile from non-members', async () => {
      const ctx = setup();
      ctx.communityProfileRepository.findOne
        .mockResolvedValueOnce(profile(CommunityProfileRole.MEMBER, true))
        .mockResolvedValueOnce(null);

      await expect(
        ctx.service.findCommunityProfileBadges(5, 'viewer'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns 404 for a missing profile', async () => {
      const ctx = setup();
      ctx.communityProfileRepository.findOne.mockResolvedValue(null);

      await expect(
        ctx.service.findCommunityProfileBadges(5, 'viewer'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('Pro (badge derivado de la suscripción)', () => {
    const proBadge = (overrides: Partial<Badge> = {}) =>
      badge({
        id: 9,
        code: BADGE_CODES.PRO,
        name: 'Pro',
        scope: BadgeScope.USER,
        rarity: BadgeRarity.EPIC,
        threshold: null,
        ...overrides,
      });

    it('se agrega a los badges del usuario con derived: true y sin fecha mientras sea Pro', async () => {
      const ctx = setup();
      ctx.proStatusService.isPro.mockResolvedValue(true);
      ctx.badgeRepository.findOne.mockResolvedValue(proBadge());
      ctx.userBadgeRepository.find.mockResolvedValue([
        {
          awardedAt: new Date('2026-01-01'),
          badge: badge({
            id: 1,
            code: BADGE_CODES.VERIFIED_SELLER,
            scope: BadgeScope.USER,
            rarity: BadgeRarity.UNCOMMON,
          }),
        },
      ]);

      const items = await ctx.service.findUserBadges('user-id');

      expect(ctx.proStatusService.isPro).toHaveBeenCalledWith('user-id');
      expect(ctx.badgeRepository.findOne).toHaveBeenCalledWith({
        where: { code: BADGE_CODES.PRO, isActive: true },
      });
      // Ordena por rareza junto a los ganados: epic antes que uncommon.
      expect(items.map((item) => item.code)).toEqual([
        BADGE_CODES.PRO,
        BADGE_CODES.VERIFIED_SELLER,
      ]);
      expect(items[0]).toMatchObject({
        scope: 'user',
        derived: true,
        awardedAt: null,
      });
      expect(items[1]).toMatchObject({ derived: false });
    });

    it('sin Pro vigente no aparece ni se consulta el catálogo', async () => {
      const ctx = setup();

      await expect(ctx.service.findUserBadges('user-id')).resolves.toEqual([]);

      expect(ctx.badgeRepository.findOne).not.toHaveBeenCalled();
    });

    it('si el badge está desactivado en el catálogo no se muestra', async () => {
      const ctx = setup();
      ctx.proStatusService.isPro.mockResolvedValue(true);
      ctx.badgeRepository.findOne.mockResolvedValue(null);

      await expect(ctx.service.findUserBadges('user-id')).resolves.toEqual([]);
    });

    it('nunca se guarda: otorgarlo lanza error y no inserta', async () => {
      const ctx = setup();
      ctx.badgeRepository.findOne.mockResolvedValue(proBadge());

      await expect(
        ctx.service.awardToUser('user-id', BADGE_CODES.PRO),
      ).rejects.toBeInstanceOf(BadgeAwardError);
      expect(ctx.userBadgeRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('el catálogo lo marca como derivado', async () => {
      const ctx = setup();
      ctx.badgeRepository.find.mockResolvedValue([proBadge()]);

      const [item] = await ctx.service.findCatalog();

      expect(item).toMatchObject({ code: BADGE_CODES.PRO, derived: true });
    });

    it('backfill no lo toca', async () => {
      const ctx = setup();
      ctx.badgeRepository.find.mockResolvedValue([proBadge()]);

      const result = await ctx.service.backfill();

      expect(result).not.toHaveProperty(BADGE_CODES.PRO);
      expect(ctx.dataSource.query).not.toHaveBeenCalled();
    });
  });

  describe('anniversary and backfill', () => {
    it('awards anniversaries in batches until a partial batch', async () => {
      const ctx = setup();
      ctx.badgeRepository.findOne.mockResolvedValue(
        badge({
          id: 4,
          code: BADGE_CODES.ANNIVERSARY,
          scope: BadgeScope.USER,
          threshold: 365,
        }),
      );
      ctx.dataSource.query
        .mockResolvedValueOnce([{ count: 500 }])
        .mockResolvedValueOnce([{ count: 120 }]);

      await expect(ctx.service.awardAnniversaries()).resolves.toBe(620);
      expect(ctx.dataSource.query).toHaveBeenCalledTimes(2);
      expect(ctx.dataSource.query.mock.calls[0][1]).toEqual([4, 365, 500]);
    });

    it('backfills idempotently and reports how many badges were new', async () => {
      const ctx = setup();
      ctx.badgeRepository.find.mockResolvedValue([
        badge({
          id: 1,
          code: BADGE_CODES.VERIFIED_SELLER,
          scope: BadgeScope.USER,
          threshold: null,
        }),
        badge({ id: 2, code: BADGE_CODES.TALKATIVE, threshold: 25 }),
      ]);
      ctx.dataSource.query.mockResolvedValue([{ count: 3 }]);

      const result = await ctx.service.backfill();

      expect(result[BADGE_CODES.VERIFIED_SELLER]).toBe(3);
      expect(result[BADGE_CODES.TALKATIVE]).toBe(3);
      // Los badges inactivos o inexistentes no se evalúan.
      expect(result[BADGE_CODES.FIRST_POST]).toBe(0);
      const sql = ctx.dataSource.query.mock.calls[0][0] as string;
      expect(sql).toContain('ON CONFLICT DO NOTHING');
    });
  });
});

describe('BadgesListener', () => {
  it('never rethrows: a badge failure does not break the main action', async () => {
    const service = {
      evaluatePostCreated: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const listener = new BadgesListener(service as unknown as BadgesService);

    await expect(
      listener.onPostCreated({ communityProfileId: 5 }),
    ).resolves.toBeUndefined();
    expect(service.evaluatePostCreated).toHaveBeenCalledWith(5);
  });

  it('subscribes to the domain events', () => {
    expect(Object.values(BadgeEvents)).toEqual(
      expect.arrayContaining([
        'user.registered',
        'forum.post.created',
        'forum.reply.created',
        'community.member.joined',
        'seller.approved',
        'product.published',
        'favorite.saved',
      ]),
    );
  });
});
