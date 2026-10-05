import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateCategoryDto } from './create-category.dto';

describe('CreateCategoryDto', () => {
  it('trims a valid category name', () => {
    const dto = plainToInstance(CreateCategoryDto, { name: '  Anime  ' });

    expect(dto.name).toBe('Anime');
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects an empty or whitespace-only name', () => {
    const dto = plainToInstance(CreateCategoryDto, { name: '   ' });

    expect(validateSync(dto)).not.toHaveLength(0);
  });
});
