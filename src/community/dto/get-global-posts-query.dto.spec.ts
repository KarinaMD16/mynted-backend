import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetGlobalPostsQueryDto } from './get-global-posts-query.dto';

describe('GetGlobalPostsQueryDto tagIds', () => {
  it('keeps tagIds optional and defaults pagination to page 1 and limit 20', async () => {
    const dto = plainToInstance(GetGlobalPostsQueryDto, {});

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(dto.tagIds).toBeUndefined();
  });

  it.each([
    ['1', [1]],
    ['1,3,5', [1, 3, 5]],
    [
      ['1', '3'],
      [1, 3],
    ],
  ])('parses %p as integer tag ids', async (input, expected) => {
    const dto = plainToInstance(GetGlobalPostsQueryDto, { tagIds: input });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.tagIds).toEqual(expected);
  });

  it.each([['0'], ['1,0'], ['1,1'], ['abc']])(
    'rejects invalid tagIds %p',
    async (tagIds) => {
      const dto = plainToInstance(GetGlobalPostsQueryDto, { tagIds });

      await expect(validate(dto)).resolves.not.toHaveLength(0);
    },
  );
});
