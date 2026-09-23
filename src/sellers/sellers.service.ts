import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
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

interface PostgresError {
  code?: string;
}

@Injectable()
export class SellersService {
  constructor(
    @InjectRepository(Seller)
    private readonly sellerRepository: Repository<Seller>,
    private readonly usersService: UsersService,
    private readonly dataSource: DataSource,
  ) {}

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

  async findPendingRequests(): Promise<Seller[]> {
    return this.sellerRepository.find({
      where: { user: { sellerRequestStatus: SellerRequestStatus.PENDING } },
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

    const seller = await this.sellerRepository.findOne({
      where: { userId: targetUserId },
    });
    if (!seller) {
      throw new NotFoundException(
        'No se encontró el registro de vendedor para este usuario',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      if (dto.status === SellerRequestStatus.APPROVED) {
        await manager.update(Seller, seller.sellerId, { isVerified: true });
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
  }
}
