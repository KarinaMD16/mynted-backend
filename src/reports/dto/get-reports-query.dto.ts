import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReportItemType } from '../enums/report-item-type.enum';
import { ReportStatus } from '../enums/report-status.enum';

export class GetReportsQueryDto {
  @ApiPropertyOptional({ enum: ReportStatus })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiPropertyOptional({ enum: ReportItemType })
  @IsOptional()
  @IsEnum(ReportItemType)
  itemType?: ReportItemType;

  @ApiPropertyOptional({ type: Number, minimum: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @IsPositive()
  communityId?: number;

  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
