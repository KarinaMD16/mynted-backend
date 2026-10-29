import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ModerationActionsService } from '../moderation-actions/moderation-actions.service';
import {
  MODERATION_ACTIONS,
  MODERATION_TARGET_TYPES,
} from '../moderation-actions/constants/moderation-action.constants';
import { Seller } from '../sellers/entities/seller.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { PaymentDispute } from './entities/payment-dispute.entity';
import { TransactionStatus } from './enums/transaction-status.enum';
import { ShippingStatus } from './enums/shipping-status.enum';
import { PaymentDisputeStatus } from './enums/payment-dispute-status.enum';
import { PaymentDisputeAction } from './enums/payment-dispute-action.enum';
import { CreatePaymentDisputeDto } from './dto/create-payment-dispute.dto';
import { PaymentDisputeQueryDto } from './dto/payment-dispute-query.dto';
import {
  PaymentDisputeItemDto,
  PaymentDisputeListResponseDto,
} from './dto/payment-dispute-response.dto';
import { ResolvePaymentDisputeDto } from './dto/resolve-payment-dispute.dto';
import { PaymentDisputeResolvedEvent } from './payment-events';
import { PaymentEvents } from './payment-events';

@Injectable()
export class PaymentDisputesService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(PaymentDispute)
    private readonly disputeRepository: Repository<PaymentDispute>,
    @InjectRepository(PaymentTransaction)
    private readonly transactionRepository: Repository<PaymentTransaction>,
    private readonly moderationActionsService: ModerationActionsService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  async create(
    transactionId: string,
    userId: string,
    dto: CreatePaymentDisputeDto,
  ): Promise<PaymentDisputeItemDto> {
    let disputeId: string | null = null;
    try {
      await this.dataSource.transaction(async (manager) => {
        const transaction = await manager
          .getRepository(PaymentTransaction)
          .findOne({
            where: { id: transactionId },
            lock: { mode: 'pessimistic_write' },
          });
        if (!transaction) {
          throw new NotFoundException('Transacción no encontrada');
        }
        if (transaction.buyerId !== userId) {
          throw new ForbiddenException(
            'No tienes permiso para abrir este reclamo',
          );
        }
        if (
          transaction.status !== TransactionStatus.COMPLETED ||
          transaction.shippingStatus !== ShippingStatus.DELIVERED
        ) {
          throw new ConflictException(
            'El reclamo solo puede abrirse después de la entrega',
          );
        }

        const existing = await manager
          .getRepository(PaymentDispute)
          .findOne({ where: { transactionId } });
        if (existing) {
          throw new ConflictException(
            'Ya existe un reclamo para esta transacción',
          );
        }

        const dispute = manager.getRepository(PaymentDispute).create({
          transactionId,
          buyerId: userId,
          reason: dto.reason,
          status: PaymentDisputeStatus.OPEN,
          resolution: null,
          resolutionNote: null,
          resolvedByUserId: null,
          resolvedAt: null,
        });
        const saved = await manager.getRepository(PaymentDispute).save(dispute);
        disputeId = saved.id;
      });
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'Ya existe un reclamo para esta transacción',
        );
      }
      throw error;
    }

    return this.findById(disputeId!);
  }

  async findAll(
    query: PaymentDisputeQueryDto,
  ): Promise<PaymentDisputeListResponseDto> {
    const qb = this.disputeQuery();
    if (query.status) {
      qb.andWhere('dispute.status = :status', { status: query.status });
    }
    const [rows, total] = await qb
      .orderBy('dispute.createdAt', 'DESC')
      .addOrderBy('dispute.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    return {
      data: rows.map((row) => this.toResponse(row)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async findById(id: string): Promise<PaymentDisputeItemDto> {
    const dispute = await this.disputeQuery()
      .andWhere('dispute.id = :id', { id })
      .getOne();
    if (!dispute) throw new NotFoundException('Reclamo no encontrado');
    return this.toResponse(dispute);
  }

  async resolve(
    id: string,
    actorUserId: string,
    dto: ResolvePaymentDisputeDto,
  ): Promise<PaymentDisputeItemDto> {
    let event: PaymentDisputeResolvedEvent | null = null;
    await this.dataSource.transaction(async (manager) => {
      const disputeRepository = manager.getRepository(PaymentDispute);
      const dispute = await disputeRepository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!dispute) throw new NotFoundException('Reclamo no encontrado');
      if (dispute.status !== PaymentDisputeStatus.OPEN) {
        throw new ConflictException('El reclamo ya fue resuelto');
      }

      const transaction = await manager
        .getRepository(PaymentTransaction)
        .findOne({
          where: { id: dispute.transactionId },
          relations: { seller: true },
          lock: { mode: 'pessimistic_write' },
        });
      if (!transaction)
        throw new NotFoundException('Transacción no encontrada');
      if (transaction.status === TransactionStatus.REFUNDED) {
        throw new ConflictException('La transacción ya fue reembolsada');
      }

      if (dto.action === PaymentDisputeAction.REFUND) {
        const seller = await manager.getRepository(Seller).findOne({
          where: { sellerId: transaction.sellerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!seller) throw new NotFoundException('Vendedor no encontrado');
        seller.completedSalesCount = Math.max(
          0,
          seller.completedSalesCount - 1,
        );
        transaction.status = TransactionStatus.REFUNDED;
        await manager.getRepository(Seller).save(seller);
      }

      dispute.status =
        dto.action === PaymentDisputeAction.REFUND
          ? PaymentDisputeStatus.RESOLVED_REFUND
          : PaymentDisputeStatus.RESOLVED_CLOSED;
      dispute.resolution = dto.action;
      dispute.resolutionNote = dto.resolution;
      dispute.resolvedByUserId = actorUserId;
      dispute.resolvedAt = new Date();

      await manager.getRepository(PaymentTransaction).save(transaction);
      await disputeRepository.save(dispute);
      await this.moderationActionsService.record(
        {
          actorUserId,
          targetType: MODERATION_TARGET_TYPES.PAYMENT_DISPUTE,
          targetId: dispute.id,
          action:
            dto.action === PaymentDisputeAction.REFUND
              ? MODERATION_ACTIONS.PAYMENT_DISPUTE_REFUNDED
              : MODERATION_ACTIONS.PAYMENT_DISPUTE_CLOSED,
          reason: dto.resolution,
          communityId: null,
        },
        manager,
      );

      event = {
        disputeId: dispute.id,
        transactionId: transaction.id,
        productId: transaction.productId,
        buyerId: transaction.buyerId,
        sellerUserId: transaction.seller.userId,
        action: dto.action,
      };
    });

    if (event)
      this.eventEmitter?.emit(PaymentEvents.PAYMENT_DISPUTE_RESOLVED, event);
    return this.findById(id);
  }

  private disputeQuery() {
    return this.disputeRepository
      .createQueryBuilder('dispute')
      .withDeleted()
      .innerJoinAndSelect('dispute.transaction', 'transaction')
      .innerJoinAndSelect('dispute.buyer', 'buyer')
      .innerJoinAndSelect('transaction.seller', 'seller')
      .innerJoinAndSelect('transaction.product', 'product')
      .select([
        'dispute.id',
        'dispute.transactionId',
        'dispute.buyerId',
        'dispute.reason',
        'dispute.status',
        'dispute.resolution',
        'dispute.resolutionNote',
        'dispute.resolvedAt',
        'dispute.createdAt',
        'transaction.id',
        'transaction.status',
        'transaction.shippingStatus',
        'transaction.productId',
        'transaction.sellerId',
        'buyer.id',
        'buyer.username',
        'seller.sellerId',
        'seller.userId',
        'seller.displayName',
        'product.id',
        'product.title',
      ]);
  }

  private toResponse(dispute: PaymentDispute): PaymentDisputeItemDto {
    return {
      id: dispute.id,
      transactionId: dispute.transactionId,
      status: dispute.status,
      reason: dispute.reason,
      resolution: dispute.resolution ?? null,
      resolutionNote: dispute.resolutionNote ?? null,
      createdAt: dispute.createdAt,
      resolvedAt: dispute.resolvedAt ?? null,
      paymentStatus: dispute.transaction.status,
      shippingStatus: dispute.transaction.shippingStatus ?? null,
      buyer: {
        id: dispute.buyer.id,
        username: dispute.buyer.username,
      },
      seller: {
        id: String(dispute.transaction.seller.sellerId),
        displayName: dispute.transaction.seller.displayName,
      },
      product: {
        id: dispute.transaction.product.id,
        title: dispute.transaction.product.title,
      },
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505'
    );
  }
}
