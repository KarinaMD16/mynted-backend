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
  ): Promise<User> {
    const user = await this.usersService.findById(targetUserId);

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
}
