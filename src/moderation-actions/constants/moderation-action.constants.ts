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
} as const;

export type ModerationActionType =
  (typeof MODERATION_ACTIONS)[keyof typeof MODERATION_ACTIONS];
