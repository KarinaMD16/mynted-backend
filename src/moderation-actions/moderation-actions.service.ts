import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  ModerationActionType,
  ModerationTargetType,
} from './constants/moderation-action.constants';
import { ModerationActionQueryDto } from './dto/moderation-action-query.dto';
import {
  ModerationActionItemDto,
  ModerationActionListResponseDto,
} from './dto/moderation-action-response.dto';
import { ModerationAction } from './entities/moderation-action.entity';

export interface RecordModerationActionInput {
  actorUserId: string;
  targetType: ModerationTargetType;
  targetId: string | number;
  action: ModerationActionType;
  reason?: string | null;
  communityId?: number | null;
}

@Injectable()
export class ModerationActionsService {
  constructor(
    @InjectRepository(ModerationAction)
    private readonly repository: Repository<ModerationAction>,
  ) {}

  async record(
    input: RecordModerationActionInput,
    manager?: EntityManager,
  ): Promise<ModerationAction> {
    if (!input.actorUserId?.trim()) {
      throw new BadRequestException('actorUserId es requerido');
    }
    if (!input.targetType?.trim()) {
      throw new BadRequestException('targetType es requerido');
    }
    if (!input.action?.trim()) {
      throw new BadRequestException('action es requerida');
    }

    const targetId = String(input.targetId);
    if (!targetId.trim()) {
      throw new BadRequestException('targetId es requerido');
    }
    if (
      input.communityId !== undefined &&
      input.communityId !== null &&
      (!Number.isInteger(input.communityId) || input.communityId < 1)
    ) {
      throw new BadRequestException('communityId debe ser un entero positivo');
    }

    const repository =
      manager?.getRepository(ModerationAction) ?? this.repository;
    const action = repository.create({
      actorUserId: input.actorUserId,
      targetType: input.targetType,
      targetId,
      action: input.action,
      reason: input.reason?.trim() || null,
      communityId: input.communityId ?? null,
    });
    return repository.save(action);
  }

  async findAll(
    query: ModerationActionQueryDto,
  ): Promise<ModerationActionListResponseDto> {
    const [actions, total] = await this.repository.findAndCount({
      relations: { actor: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      data: actions.map((action) => ModerationActionItemDto.fromEntity(action)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }
}
