import { getMetadataArgsStorage } from 'typeorm';
import { ModerationAction } from './moderation-action.entity';

describe('ModerationAction entity metadata', () => {
  it('maps the append-only audit fields and indexes', () => {
    const storage = getMetadataArgsStorage();
    const columns = storage.columns.filter(
      (column) => column.target === ModerationAction,
    );
    const indexes = storage.indices.filter(
      (index) => index.target === ModerationAction,
    );

    expect(
      storage.tables.find((table) => table.target === ModerationAction)?.name,
    ).toBe('moderation_action');
    expect(columns.map((column) => column.propertyName)).toEqual(
      expect.arrayContaining([
        'id',
        'actorUserId',
        'targetType',
        'targetId',
        'action',
        'reason',
        'communityId',
        'createdAt',
      ]),
    );
    expect(columns.map((column) => column.propertyName)).not.toEqual(
      expect.arrayContaining(['updatedAt', 'deletedAt', 'metadata']),
    );
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        'IDX_moderation_action_created_at_id',
        'IDX_moderation_action_actor_user_id',
        'IDX_moderation_action_target',
      ]),
    );
  });
});
