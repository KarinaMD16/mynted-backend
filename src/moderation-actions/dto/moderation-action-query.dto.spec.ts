import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ModerationActionQueryDto } from './moderation-action-query.dto';

describe('ModerationActionQueryDto', () => {
  it('accepts supported filters and transforms numeric values', async () => {
    const dto = plainToInstance(ModerationActionQueryDto, {
      page: '2',
      limit: '10',
      action: 'report_resolved',
      targetType: 'report',
      targetId: '8',
      communityId: '2',
      actorUserId: '550e8400-e29b-41d4-a716-446655440000',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-31T23:59:59.999Z',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(10);
    expect(dto.communityId).toBe(2);
  });

  it.each([
    { action: 'unknown_action' },
    { targetType: 'unknown_target' },
    { actorUserId: 'abc' },
    { communityId: '0' },
    { from: 'ayer' },
    { to: 'ayer' },
  ])('rejects invalid filter: %j', async (input) => {
    const dto = plainToInstance(ModerationActionQueryDto, input);
    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });
});
