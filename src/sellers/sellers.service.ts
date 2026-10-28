import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadgeEvents } from '../badges/badge-events';
import { SellerEvents, SellerRejectedEvent } from './seller-events';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import {
  SellerRequestStatus,
  User,
  UserRole,
} from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { Seller } from './entities/seller.entity';
import { PaymentInfo } from './entities/payment-info.entity';
import { RequestSellerDto } from './dto/request-seller.dto';
import { UpdateSellerStatusDto } from './dto/update-seller-status.dto';
import { CommissionService } from '../payments/commission/commission.service';
import { CommissionEstimateResponseDto } from './dto/commission-estimate-response.dto';
import { CommissionProfileResponseDto } from './dto/seller-commission-response.dto';
import { CommissionCatalogService } from '../payments/commission/commission-catalog.service';
import { Product, ProductStatus } from '../products/entities/product.entity';
import { ModerationActionsService } from '../moderation-actions/moderation-actions.service';
import {
  MODERATION_ACTIONS,
  MODERATION_TARGET_TYPES,
} from '../moderation-actions/constants/moderation-action.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/enums/notification-type.enum';

interface PostgresError {
  code?: string;
}

@Injectable()
export class SellersService {
  constructor(
    @InjectRepository(Seller)
    private readonly sellerRepository: Repository<Seller>,
    private readonly usersService: UsersService,
    private readonly commissionService: CommissionService,
    private readonly dataSource: DataSource,
    @Optional()
    private readonly eventEmitter?: EventEmitter2,
    @Optional()
    private readonly commissionCatalogService?: CommissionCatalogService,
    @Optional()
    private readonly moderationActionsService?: ModerationActionsService,
    @Optional()
    private readonly notificationsService?: NotificationsService,
  ) {}

  async estimateCommission(
    userId: string,
    amount: number,
  ): Promise<CommissionEstimateResponseDto> {
    const seller = await this.sellerRepository.findOne({
      where: { userId },
    });
    if (!seller) {
      throw new NotFoundException(
        'No se encontró el registro de vendedor para este usuario',
      );
    }

    const user = await this.usersService.findById(userId);
    if (typeof user.currency !== 'string' || user.currency.trim() === '') {
      throw new BadRequestException(
        'Configura tu moneda antes de estimar una comisión',
      );
    }
    const currency = user.currency.trim().toUpperCase();
    const calculation = await this.commissionService.calculate(
      amount,
      currency,
      seller.completedSalesCount,
    );

    return {
      amount,
      currency,
      commissionRate: calculation.rate,
      commissionAmount: calculation.commissionAmount,
      sellerNet: calculation.sellerNet,
      salesTierName: calculation.salesTier,
      priceTierName: calculation.priceTier,
      salesDiscount: calculation.salesDiscount,
      priceDiscount: calculation.priceDiscount,
    };
  }

  async getCommissionProfile(
    userId: string,
  ): Promise<CommissionProfileResponseDto> {
    const user = await this.usersService.findById(userId);
    if (typeof user.currency !== 'string' || user.currency.trim() === '') {
      throw new BadRequestException(
        'Configura tu moneda antes de consultar tu comisión',
      );
    }
    const currency = user.currency.trim().toUpperCase();
    const seller = await this.sellerRepository.findOne({ where: { userId } });
    if (!seller) {
      throw new NotFoundException(
        'No se encontró el registro de vendedor para este usuario',
      );
    }

    const salesTiers = await this.commissionCatalogService!.getSalesTiers();
    const currentIndex = salesTiers.findIndex(
      (tier) =>
        tier.minValue <= seller.completedSalesCount &&
        (tier.maxValue === null || seller.completedSalesCount < tier.maxValue),
    );
    if (currentIndex < 0) {
      throw new NotFoundException(
        'No existe un tier de ventas activo aplicable',
      );
    }
    const currentTier = salesTiers[currentIndex];
    const nextTier = salesTiers[currentIndex + 1] ?? null;
    const priceResolution =
      await this.commissionCatalogService!.getPriceTiers(currency);
    const matrix = this.commissionCatalogService!.buildMatrix(
      salesTiers,
      priceResolution.tiers,
    );

    return {
      currency,
      completedSalesCount: seller.completedSalesCount,
      currentTier: {
        name: currentTier.name,
        minValue: currentTier.minValue,
        maxValue: currentTier.maxValue,
        discount: currentTier.discount,
      },
      nextTier: nextTier
        ? {
            name: nextTier.name,
            minValue: nextTier.minValue,
            maxValue: nextTier.maxValue,
            discount: nextTier.discount,
          }
        : null,
      salesRemaining: nextTier
        ? nextTier.minValue - seller.completedSalesCount
        : null,
      priceTiers: priceResolution.tiers,
      matrix,
    };
  }

  async requestSeller(userId: string, dto: RequestSellerDto): Promise<User> {
    const user = await this.usersService.findById(userId);

    if (
      user.role === UserRole.SELLER ||
      user.sellerRequestStatus === SellerRequestStatus.APPROVED
    ) {
      throw new ConflictException('Ya eres vendedor');
    }

    if (user.sellerRequestStatus === SellerRequestStatus.PENDING) {
      throw new ConflictException(
        'Ya tienes una solicitud de vendedor en revisión',
      );
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const paymentInfo = manager.create(PaymentInfo, {
          ownerFullName: dto.ownerFullName,
          name: dto.name,
          number: dto.number,
          type: dto.type,
        });
        const savedPaymentInfo = await manager.save(PaymentInfo, paymentInfo);

        const seller = manager.create(Seller, {
          displayName: dto.displayName,
          description: dto.description,
          location: dto.location,
          isVerified: false,
          userId,
          paymentId: savedPaymentInfo.paymentInfoId,
        });
        await manager.save(Seller, seller);

        await manager.update(User, userId, {
          sellerRequestStatus: SellerRequestStatus.PENDING,
          sellerRequestedAt: new Date(),
        });

        const updatedUser = await manager.findOne(User, {
          where: { id: userId },
        });
        if (!updatedUser) {
          throw new InternalServerErrorException(
            'No fue posible recuperar el usuario actualizado',
          );
        }
        return updatedUser;
      });
    } catch (error: unknown) {
      if (error instanceof QueryFailedError) {
        const dbError = error.driverError as PostgresError;
        if (dbError.code === '23505') {
          // Ya existe un registro seller para este userId (p.ej. de una
          // solicitud rechazada anteriormente). El esquema no define un flujo
          // de reintento/limpieza para este caso todavía.
          throw new ConflictException(
            'Ya existe un registro de vendedor asociado a tu cuenta. Contacta soporte para continuar',
          );
        }
      }
      throw error;
    }
  }

  // Lista solicitudes por estado (pending por defecto, para no romper a los
  // clientes existentes).
  async findRequests(
    status: SellerRequestStatus = SellerRequestStatus.PENDING,
  ): Promise<Seller[]> {
    return this.sellerRepository.find({
      where: { user: { sellerRequestStatus: status } },
      relations: { user: true, paymentInfo: true },
      order: { user: { sellerRequestedAt: 'ASC' } },
    });
  }

  async findPendingRequestByUserId(userId: string): Promise<Seller> {
    const seller = await this.sellerRepository.findOne({
      where: {
        userId,
        user: { sellerRequestStatus: SellerRequestStatus.PENDING },
      },
      relations: { user: true, paymentInfo: true },
    });

    if (!seller) {
      throw new NotFoundException(
        'Este usuario no tiene una solicitud de vendedor pendiente',
      );
    }

    return seller;
  }

  async updateSellerStatus(
    targetUserId: string,
    dto: UpdateSellerStatusDto,
    actorUserId: string,
  ): Promise<User> {
    const user = await this.usersService.findById(targetUserId);

    if (
      dto.status === SellerRequestStatus.REVOKED &&
      user.sellerRequestStatus === SellerRequestStatus.APPROVED
    ) {
      const reason = typeof dto.reason === 'string' ? dto.reason.trim() : '';
      if (!reason || reason.length > 500) {
        throw new BadRequestException(
          'reason es obligatorio al revocar un vendedor y no puede superar 500 caracteres',
        );
      }
      const updated = await this.revokeApprovedSeller(
        targetUserId,
        reason,
        actorUserId,
      );
      await this.notifySellerStatusChange(
        targetUserId,
        NotificationType.SELLER_REVOKED,
        `Tus privilegios de vendedor fueron revocados: ${reason}`,
        { reason },
      );
      return updated;
    }

    if (
      dto.status === SellerRequestStatus.APPROVED &&
      user.sellerRequestStatus === SellerRequestStatus.REVOKED
    ) {
      const updated = await this.restoreRevokedSeller(
        targetUserId,
        actorUserId,
      );
      await this.notifySellerStatusChange(
        targetUserId,
        NotificationType.SELLER_RESTORED,
        'Tus privilegios de vendedor fueron restaurados. Ya puedes volver a vender.',
        {},
      );
      return updated;
    }

    if (
      (dto.status === SellerRequestStatus.REVOKED &&
        user.sellerRequestStatus === SellerRequestStatus.REVOKED) ||
      (dto.status === SellerRequestStatus.APPROVED &&
        user.sellerRequestStatus === SellerRequestStatus.APPROVED)
    ) {
      throw new ConflictException('El usuario ya tiene ese estado de vendedor');
    }

    if (user.sellerRequestStatus !== SellerRequestStatus.PENDING) {
      throw new BadRequestException(
        'Este usuario no tiene una solicitud de vendedor pendiente',
      );
    }

    if (dto.status === SellerRequestStatus.APPROVED && !user.currency) {
      throw new BadRequestException(
        'El usuario debe tener una moneda (currency) configurada antes de aprobarlo como vendedor',
      );
    }

    const seller = await this.sellerRepository.findOne({
      where: { userId: targetUserId },
    });
    if (!seller) {
      throw new NotFoundException(
        'No se encontró el registro de vendedor para este usuario',
      );
    }

    const updated = await this.dataSource.transaction(async (manager) => {
      if (dto.status === SellerRequestStatus.APPROVED) {
        await manager.update(Seller, seller.sellerId, {
          isVerified: true,
          approvedAt: new Date(),
        });
        await manager.update(User, targetUserId, {
          role: UserRole.SELLER,
          sellerRequestStatus: SellerRequestStatus.APPROVED,
        });
      } else {
        await manager.update(User, targetUserId, {
          sellerRequestStatus: SellerRequestStatus.REJECTED,
        });
      }

      const updatedUser = await manager.findOne(User, {
        where: { id: targetUserId },
      });
      if (!updatedUser) {
        throw new InternalServerErrorException(
          'No fue posible recuperar el usuario actualizado',
        );
      }
      return updatedUser;
    });

    if (dto.status === SellerRequestStatus.APPROVED) {
      this.eventEmitter?.emit(BadgeEvents.SELLER_APPROVED, {
        userId: targetUserId,
      });
    } else {
      const event: SellerRejectedEvent = { userId: targetUserId };
      this.eventEmitter?.emit(SellerEvents.REJECTED, event);
    }

    return updated;
  }

  private async revokeApprovedSeller(
    targetUserId: string,
    reason: string,
    actorUserId: string,
  ): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      const lockedUser = await manager.getRepository(User).findOne({
        where: { id: targetUserId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedUser) {
        throw new NotFoundException('Usuario no encontrado');
      }
      if (lockedUser.sellerRequestStatus !== SellerRequestStatus.APPROVED) {
        if (lockedUser.sellerRequestStatus === SellerRequestStatus.REVOKED) {
          throw new ConflictException(
            'El usuario ya tiene ese estado de vendedor',
          );
        }
        throw new BadRequestException(
          'Solo se puede revocar un vendedor aprobado',
        );
      }

      const seller = await manager.getRepository(Seller).findOne({
        where: { userId: targetUserId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!seller) {
        throw new NotFoundException(
          'No se encontrÃ³ el registro de vendedor para este usuario',
        );
      }

      await manager.update(Seller, seller.sellerId, { isVerified: false });
      await manager.update(User, targetUserId, {
        sellerRequestStatus: SellerRequestStatus.REVOKED,
      });
      await manager
        .getRepository(Product)
        .createQueryBuilder()
        .update(Product)
        .set({ status: ProductStatus.INACTIVE })
        .where(
          'seller_id = :sellerId AND status = :active AND deleted_at IS NULL',
          { sellerId: seller.sellerId, active: ProductStatus.ACTIVE },
        )
        .execute();

      if (!this.moderationActionsService) {
        throw new InternalServerErrorException(
          'El servicio de auditorÃ­a de moderaciÃ³n no estÃ¡ disponible',
        );
      }
      await this.moderationActionsService.record(
        {
          actorUserId,
          targetType: MODERATION_TARGET_TYPES.USER,
          targetId: targetUserId,
          action: MODERATION_ACTIONS.SELLER_REVOKED,
          reason: reason.trim(),
          communityId: null,
        },
        manager,
      );

      const updatedUser = await manager.findOne(User, {
        where: { id: targetUserId },
      });
      if (!updatedUser) {
        throw new InternalServerErrorException(
          'No fue posible recuperar el usuario actualizado',
        );
      }
      return updatedUser;
    });
  }

  private async restoreRevokedSeller(
    targetUserId: string,
    actorUserId: string,
  ): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      const lockedUser = await manager.getRepository(User).findOne({
        where: { id: targetUserId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedUser) {
        throw new NotFoundException('Usuario no encontrado');
      }
      if (lockedUser.sellerRequestStatus !== SellerRequestStatus.REVOKED) {
        if (lockedUser.sellerRequestStatus === SellerRequestStatus.APPROVED) {
          throw new ConflictException(
            'El usuario ya tiene ese estado de vendedor',
          );
        }
        throw new BadRequestException(
          'Solo se puede restaurar un vendedor revocado',
        );
      }

      const seller = await manager.getRepository(Seller).findOne({
        where: { userId: targetUserId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!seller) {
        throw new NotFoundException(
          'No se encontrÃ³ el registro de vendedor para este usuario',
        );
      }

      await manager.update(Seller, seller.sellerId, { isVerified: true });
      await manager.update(User, targetUserId, {
        sellerRequestStatus: SellerRequestStatus.APPROVED,
      });

      if (!this.moderationActionsService) {
        throw new InternalServerErrorException(
          'El servicio de auditorÃ­a de moderaciÃ³n no estÃ¡ disponible',
        );
      }
      await this.moderationActionsService.record(
        {
          actorUserId,
          targetType: MODERATION_TARGET_TYPES.USER,
          targetId: targetUserId,
          action: MODERATION_ACTIONS.SELLER_RESTORED,
          reason: null,
          communityId: null,
        },
        manager,
      );

      const updatedUser = await manager.findOne(User, {
        where: { id: targetUserId },
      });
      if (!updatedUser) {
        throw new InternalServerErrorException(
          'No fue posible recuperar el usuario actualizado',
        );
      }
      return updatedUser;
    });
  }

  private async notifySellerStatusChange(
    userId: string,
    type: NotificationType,
    message: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!this.notificationsService) return;
    try {
      await this.notificationsService.notify(
        [{ userId, type, data, message }],
        { allowInactiveRecipient: true },
      );
    } catch {
      // Las notificaciones son post-commit y no deben revertir el cambio.
    }
  }
}
