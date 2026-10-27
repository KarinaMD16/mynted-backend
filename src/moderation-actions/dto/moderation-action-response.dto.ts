import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ModerationAction } from '../entities/moderation-action.entity';

export class ModerationActionActorDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiPropertyOptional({ nullable: true })
  photoUrl!: string | null;

  @ApiProperty()
  role!: string;
}

export class ModerationActionItemDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  action!: string;

  @ApiProperty()
  targetType!: string;

  @ApiProperty()
  targetId!: string;

  @ApiPropertyOptional({ nullable: true })
  reason!: string | null;

  @ApiPropertyOptional({ nullable: true })
  communityId!: number | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: ModerationActionActorDto })
  actor!: ModerationActionActorDto;

  static fromEntity(action: ModerationAction): ModerationActionItemDto {
    return {
      id: action.id,
      action: action.action,
      targetType: action.targetType,
      targetId: action.targetId,
      reason: action.reason,
      communityId: action.communityId,
      createdAt: action.createdAt,
      actor: {
        id: action.actor.id,
        username: action.actor.username,
        photoUrl: action.actor.photoUrl ?? null,
        role: action.actor.role,
      },
    };
  }
}

export class ModerationActionPaginationDto {
  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  totalPages!: number;
}

export class ModerationActionListResponseDto {
  @ApiProperty({ type: [ModerationActionItemDto] })
  data!: ModerationActionItemDto[];

  @ApiProperty({ type: ModerationActionPaginationDto })
  pagination!: ModerationActionPaginationDto;
}
