import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CommissionEstimateQueryDto } from './commission-estimate-query.dto';

describe('CommissionEstimateQueryDto', () => {
  it.each(['', 'abc', '0', '-10', '10.123'])(
    'rejects amount=%s',
    async (amount) => {
      const dto = plainToInstance(CommissionEstimateQueryDto, { amount });
      await expect(validate(dto)).resolves.not.toHaveLength(0);
    },
  );

  it.each(['120000', '199.99'])(
    'accepts amount=%s as a number',
    async (amount) => {
      const dto = plainToInstance(CommissionEstimateQueryDto, { amount });
      expect(typeof dto.amount).toBe('number');
      await expect(validate(dto)).resolves.toHaveLength(0);
    },
  );
});
