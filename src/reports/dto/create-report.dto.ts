import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportItemType } from '../enums/report-item-type.enum';
import { ReportReason } from '../enums/report-reason.enum';

export class CreateReportDto {
  @ApiProperty({ enum: ReportItemType, example: ReportItemType.POST })
  @IsEnum(ReportItemType)
  itemType!: ReportItemType;

  @ApiProperty({ example: 42, minimum: 1 })
  @IsInt()
  @IsPositive()
  itemId!: number;

  @ApiProperty({ enum: ReportReason, example: ReportReason.SPAM })
  @IsEnum(ReportReason)
  reason!: ReportReason;

  @ApiPropertyOptional({ example: 'Contenido repetido', maxLength: 2000 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description?: string;
}
