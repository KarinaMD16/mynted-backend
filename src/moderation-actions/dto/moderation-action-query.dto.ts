import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  MODERATION_ACTIONS,
  MODERATION_TARGET_TYPES,
} from '../constants/moderation-action.constants';

export class ModerationActionQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    enum: Object.values(MODERATION_ACTIONS),
    example: MODERATION_ACTIONS.REPORT_RESOLVED,
  })
  @IsOptional()
  @IsIn(Object.values(MODERATION_ACTIONS))
  action?: string;

  @ApiPropertyOptional({
    enum: Object.values(MODERATION_TARGET_TYPES),
    example: MODERATION_TARGET_TYPES.REPORT,
  })
  @IsOptional()
  @IsIn(Object.values(MODERATION_TARGET_TYPES))
  targetType?: string;

  @ApiPropertyOptional({
    description: 'Identificador exacto del objetivo; puede ser numérico o UUID',
    example: '8',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  targetId?: string;

  @ApiPropertyOptional({ type: Number, minimum: 1, example: 2 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  communityId?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-10-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-10-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
