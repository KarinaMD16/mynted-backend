import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { GetCommunitiesQueryDto } from './get-communities-query.dto';

describe('GetCommunitiesQueryDto', () => {
  it('transforms numeric query parameters and keeps defaults', () => {
    const dto = plainToInstance(GetCommunitiesQueryDto, {
      search: '  dev  ',
      categoryId: '2',
      page: '2',
      limit: '20',
      sort: 'popularity',
    });

    expect(dto).toMatchObject({
      search: 'dev',
      categoryId: 2,
      page: 2,
      limit: 20,
      sort: 'popularity',
    });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects unsupported sorting and invalid pagination', () => {
    const dto = plainToInstance(GetCommunitiesQueryDto, {
      sort: 'name',
      page: '0',
      limit: '101',
    });

    expect(validateSync(dto)).not.toHaveLength(0);
  });
});
