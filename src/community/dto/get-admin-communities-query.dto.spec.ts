import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetAdminCommunitiesQueryDto } from './get-admin-communities-query.dto';

describe('GetAdminCommunitiesQueryDto', () => {
  it('transforms valid boolean filters and applies pagination defaults', () => {
    const query = plainToInstance(GetAdminCommunitiesQueryDto, {
      isActive: 'false',
      isPrivate: 'true',
    });

    expect(query.isActive).toBe(false);
    expect(query.isPrivate).toBe(true);
    expect(query.page).toBe(1);
    expect(query.limit).toBe(10);
  });

  it('rejects invalid boolean filters', async () => {
    const query = plainToInstance(GetAdminCommunitiesQueryDto, {
      isActive: 'not-a-boolean',
    });

    await expect(validate(query)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'isActive' }),
      ]),
    );
  });
});
