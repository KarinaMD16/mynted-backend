import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateCommunityRuleDto } from './create-community-rule.dto';

describe('CreateCommunityRuleDto', () => {
  it('normalizes one description to an array', () => {
    const dto = plainToInstance(CreateCommunityRuleDto, {
      description: 'No hacer spam',
    });

    expect(dto.description).toEqual(['No hacer spam']);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts multiple unique descriptions', () => {
    const dto = plainToInstance(CreateCommunityRuleDto, {
      description: ['No hacer spam', 'Ser respetuoso'],
    });

    expect(dto.description).toEqual(['No hacer spam', 'Ser respetuoso']);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects duplicated descriptions', () => {
    const dto = plainToInstance(CreateCommunityRuleDto, {
      description: ['No hacer spam', 'No hacer spam'],
    });

    expect(validateSync(dto)).not.toHaveLength(0);
  });
});
