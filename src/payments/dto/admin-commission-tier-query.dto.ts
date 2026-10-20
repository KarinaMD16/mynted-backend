import { Transform, TransformFnParams } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CommissionTierType } from '../enums/commission-tier-type.enum';

export class AdminCommissionTierQueryDto {
  @ApiPropertyOptional({ enum: CommissionTierType })
  @IsOptional()
  @IsEnum(CommissionTierType)
  type?: CommissionTierType;

  @ApiPropertyOptional({ example: 'CRC', minLength: 3, maxLength: 3 })
  @IsOptional()
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim().toUpperCase() : (value as unknown),
  )
  @IsString()
  @Length(3, 3)
  currency?: string;
}
