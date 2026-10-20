import { Type } from 'class-transformer';
import { IsDefined, IsNumber, IsPositive } from 'class-validator';

export class CommissionEstimateQueryDto {
  @IsDefined()
  @Type(() => Number)
  @IsNumber({
    allowInfinity: false,
    allowNaN: false,
    maxDecimalPlaces: 2,
  })
  @IsPositive()
  amount!: number;
}
