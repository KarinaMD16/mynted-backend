import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  IsNull,
  Repository,
} from 'typeorm';
import { CommissionTier } from './entities/commission-tier.entity';
import { CommissionTierType } from './enums/commission-tier-type.enum';
import { CreateCommissionTierDto } from './dto/admin-commission-tier-create.dto';
import { UpdateCommissionTierDto } from './dto/admin-commission-tier-update.dto';
import { AdminCommissionTierQueryDto } from './dto/admin-commission-tier-query.dto';

@Injectable()
export class AdminCommissionTiersService {
  constructor(
    @InjectRepository(CommissionTier)
    private readonly repository: Repository<CommissionTier>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(query: AdminCommissionTierQueryDto): Promise<CommissionTier[]> {
    if (query.type === CommissionTierType.SALES && query.currency) {
      throw new BadRequestException(
        'Los tiers de ventas no pueden tener currency',
      );
    }
    const where: Record<string, unknown> = {};
    if (query.type) where.type = query.type;
    if (query.currency) {
      where.currency = query.currency;
    } else if (query.type === CommissionTierType.SALES) {
      where.currency = IsNull();
    }
    return this.repository.find({
      where,
      order: { type: 'ASC', currency: 'ASC', minValue: 'ASC' },
    });
  }

  async findOne(id: number): Promise<CommissionTier> {
    const tier = await this.repository.findOne({ where: { id } });
    if (!tier) throw new NotFoundException('Commission tier no encontrado');
    return tier;
  }

  create(dto: CreateCommissionTierDto): Promise<CommissionTier> {
    return this.dataSource.transaction(async (manager) => {
      this.validateCurrencyInput(dto.type, dto.currency);
      const candidate = this.toTier(dto);
      this.validateFields(candidate);
      if (candidate.isActive) {
        const active = await this.loadGroup(manager, candidate);
        this.validateCoverage([...active, candidate], true);
      }
      return manager.getRepository(CommissionTier).save(candidate);
    });
  }

  update(id: number, dto: UpdateCommissionTierDto): Promise<CommissionTier> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CommissionTier);
      const current = await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current)
        throw new NotFoundException('Commission tier no encontrado');

      const candidateInput = { ...current, ...dto };
      this.validateCurrencyInput(candidateInput.type, dto.currency);
      const candidate = this.toTier(candidateInput);
      this.validateFields(candidate);
      const originalActive = current.isActive;
      const originalGroup = this.groupKey(current);
      const resultGroup = this.groupKey(candidate);
      const affected = new Map<string, CommissionTier>();
      if (originalActive) affected.set(originalGroup, current);
      if (candidate.isActive) affected.set(resultGroup, candidate);

      for (const groupTier of affected.values()) {
        const active = await this.loadGroup(manager, groupTier, id);
        const group = groupTier === candidate ? [...active, candidate] : active;
        if (
          groupTier === current &&
          resultGroup === originalGroup &&
          candidate.isActive
        ) {
          this.validateCoverage([...active, candidate], true);
        } else {
          this.validateCoverage(group, true);
        }
      }
      Object.assign(current, candidate);
      return repository.save(current);
    });
  }

  remove(id: number): Promise<CommissionTier> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CommissionTier);
      const current = await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current)
        throw new NotFoundException('Commission tier no encontrado');
      if (!current.isActive) return current;
      const active = await this.loadGroup(manager, current, id);
      this.validateCoverage(active, true);
      current.isActive = false;
      return repository.save(current);
    });
  }

  private toTier(value: Partial<CommissionTier>): CommissionTier {
    return {
      ...value,
      name: typeof value.name === 'string' ? value.name.trim() : value.name,
      currency:
        value.type === CommissionTierType.SALES
          ? null
          : typeof value.currency === 'string'
            ? value.currency.trim().toUpperCase()
            : value.currency,
      isActive: value.isActive ?? false,
    } as CommissionTier;
  }

  private validateFields(tier: CommissionTier): void {
    if (tier.type === CommissionTierType.SALES && tier.currency !== null) {
      throw new BadRequestException(
        'Los tiers de ventas requieren currency null',
      );
    }
    if (tier.type === CommissionTierType.PRICE && !tier.currency) {
      throw new BadRequestException('Los tiers de precio requieren currency');
    }
    if (!Number.isFinite(tier.minValue) || tier.minValue < 0) {
      throw new BadRequestException(
        'minValue debe ser un número mayor o igual que cero',
      );
    }
    if (tier.maxValue !== null && tier.maxValue <= tier.minValue) {
      throw new BadRequestException('maxValue debe ser mayor que minValue');
    }
    if (
      !Number.isFinite(tier.discount) ||
      tier.discount < 0 ||
      tier.discount > 1
    ) {
      throw new BadRequestException('discount debe estar entre 0 y 1');
    }
  }

  private validateCurrencyInput(
    type: CommissionTierType,
    currency: string | null | undefined,
  ): void {
    if (
      type === CommissionTierType.SALES &&
      currency !== undefined &&
      currency !== null &&
      currency.trim() !== ''
    ) {
      throw new BadRequestException(
        'Los tiers de ventas no pueden tener currency',
      );
    }
  }

  private async loadGroup(
    manager: EntityManager,
    tier: CommissionTier,
    excludeId?: number,
  ): Promise<CommissionTier[]> {
    const repository = manager.getRepository(CommissionTier);
    const where: FindOptionsWhere<CommissionTier> = {
      type: tier.type,
      isActive: true,
    };
    if (tier.type === CommissionTierType.SALES) {
      where.currency = IsNull();
    } else {
      where.currency = tier.currency!;
    }
    const rows = await repository.find({
      where,
      order: { minValue: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    return excludeId === undefined
      ? rows
      : rows.filter((row) => row.id !== excludeId);
  }

  private groupKey(tier: CommissionTier): string {
    return `${tier.type}:${tier.type === CommissionTierType.SALES ? '' : tier.currency}`;
  }

  private validateCoverage(
    tiers: CommissionTier[],
    requireNonEmpty: boolean,
  ): void {
    if (tiers.length === 0) {
      if (requireNonEmpty) {
        throw new ConflictException(
          'La operación dejaría el catálogo sin cobertura',
        );
      }
      return;
    }
    const ordered = [...tiers].sort(
      (a, b) => this.toUnits(a.minValue) - this.toUnits(b.minValue),
    );
    if (this.toUnits(ordered[0].minValue) !== 0) {
      throw new ConflictException('El primer rango activo debe comenzar en 0');
    }
    for (let index = 0; index < ordered.length; index++) {
      const current = ordered[index];
      const next = ordered[index + 1];
      if (current.maxValue === null) {
        if (next)
          throw new ConflictException('Un rango abierto debe ser el último');
        continue;
      }
      if (
        next &&
        this.toUnits(current.maxValue) !== this.toUnits(next.minValue)
      ) {
        throw new ConflictException(
          'Los rangos activos deben ser contiguos y no solaparse',
        );
      }
    }
  }

  private toUnits(value: number): number {
    return Math.round(value * 100);
  }
}
