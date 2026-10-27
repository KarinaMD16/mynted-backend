export const MODERATION_TARGET_TYPES = {
  REPORT: 'report',
  POST: 'post',
  REPLY: 'reply',
  PRODUCT: 'product',
  USER: 'user',
  SELLER: 'seller',
  COMMUNITY: 'community',
  CONVERSATION: 'conversation',
} as const;

export type ModerationTargetType =
  (typeof MODERATION_TARGET_TYPES)[keyof typeof MODERATION_TARGET_TYPES];

export const MODERATION_ACTIONS = {
  CONTENT_HIDDEN: 'content_hidden',
  CONTENT_RESTORED: 'content_restored',
  REPORT_RESOLVED: 'report_resolved',
  REPORT_DISMISSED: 'report_dismissed',
  AUTHOR_WARNED: 'author_warned',
  USER_DEACTIVATED: 'user_deactivated',
  USER_REACTIVATED: 'user_reactivated',
  USER_SOFT_DELETED: 'user_soft_deleted',
  SELLER_REVOKED: 'seller_revoked',
  SELLER_RESTORED: 'seller_restored',
} as const;

export type ModerationActionType =
  (typeof MODERATION_ACTIONS)[keyof typeof MODERATION_ACTIONS];

export const USER_DEACTIVATED_HIDDEN_REASON = 'user_deactivated' as const;
