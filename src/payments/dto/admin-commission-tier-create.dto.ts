import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommissionTierType } from '../enums/commission-tier-type.enum';

export class CreateCommissionTierDto {
  @ApiProperty({ enum: CommissionTierType })
  @IsEnum(CommissionTierType)
  type!: CommissionTierType;

  @ApiProperty({ example: 'Oro' })
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @Length(1, 100)
  name!: string;

  @ApiProperty({ example: 50 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minValue!: number;

  @ApiPropertyOptional({ example: 100, nullable: true })
  @Type(() => Number)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxValue?: number | null;

  @ApiPropertyOptional({ example: 'CRC', nullable: true })
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim().toUpperCase() : (value as unknown),
  )
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string | null;

  @ApiProperty({ example: 0.01 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  discount!: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = false;
}
