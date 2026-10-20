import { Transform, TransformFnParams } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CommissionTierType } from '../enums/commission-tier-type.enum';
import { SUPPORTED_CURRENCIES } from '../exchange-rate/exchange-rate.constants';

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
  @IsIn(SUPPORTED_CURRENCIES, {
    message: 'La moneda no está soportada por Mynted',
  })
  currency?: string;
}
