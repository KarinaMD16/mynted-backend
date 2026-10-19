import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { TransactionStatus } from './enums/transaction-status.enum';
import { SalesSummaryQueryDto } from './dto/sales-summary-query.dto';
import {
  AdminPaymentSummaryGroupDto,
  AdminPaymentSummaryPriceTierDto,
  AdminPaymentSummaryResponseDto,
  AdminPaymentSummarySalesTierDto,
} from './dto/admin-payment-summary-response.dto';
import { isIsoDate } from './exchange-rate/date.utils';
import { BadRequestException } from '@nestjs/common';

@Injectable()
export class AdminPaymentSummaryService {
  constructor(
    @InjectRepository(PaymentTransaction)
    private readonly repository: Repository<PaymentTransaction>,
  ) {}

  async summary(
    query: SalesSummaryQueryDto,
  ): Promise<AdminPaymentSummaryResponseDto> {
    this.validateDates(query);
    const bounds = this.bounds(query);
    const base = this.repository
      .createQueryBuilder('transaction')
      .where('transaction.status = :status', {
        status: TransactionStatus.COMPLETED,
      });
    if (bounds.from)
      base.andWhere('transaction.completed_at >= :from', { from: bounds.from });
    if (bounds.to)
      base.andWhere('transaction.completed_at < :to', { to: bounds.to });

    const totalsByCurrency = await this.group(base.clone(), [
      'transaction.currency',
    ]);
    const bySalesTier = await this.group(
      base.clone(),
      ['transaction.currency', 'transaction.sales_tier_name'],
      'salesTierName',
    );
    const byPriceTier = await this.group(
      base.clone(),
      ['transaction.currency', 'transaction.price_tier_name'],
      'priceTierName',
    );

    return {
      period: { from: query.from ?? null, to: query.to ?? null },
      totalsByCurrency,
      bySalesTier: bySalesTier as AdminPaymentSummarySalesTierDto[],
      byPriceTier: byPriceTier as AdminPaymentSummaryPriceTierDto[],
    };
  }

  private async group(
    query: ReturnType<Repository<PaymentTransaction>['createQueryBuilder']>,
    groups: string[],
    extraAlias?: string,
  ): Promise<AdminPaymentSummaryGroupDto[]> {
    const selects = [
      'transaction.currency AS currency',
      ...(extraAlias
        ? [
            `transaction.${extraAlias === 'salesTierName' ? 'sales_tier_name' : 'price_tier_name'} AS "${extraAlias}"`,
          ]
        : []),
      'COUNT(*) AS "transactionCount"',
      'COALESCE(SUM(transaction.amount), 0) AS gross',
      'COALESCE(SUM(transaction.commission_amount), 0) AS commissions',
      'COALESCE(SUM(transaction.seller_net), 0) AS "sellerNet"',
    ];
    const grouped = query.select(selects).groupBy(groups[0]);
    if (groups[1]) grouped.addGroupBy(groups[1]);
    const rows = await grouped
      .orderBy(groups[0], 'ASC')
      .getRawMany<Record<string, string>>();
    return rows.map((row) => ({
      ...row,
      transactionCount: Number(row.transactionCount),
      gross: this.money(row.gross),
      commissions: this.money(row.commissions),
      sellerNet: this.money(row.sellerNet),
    })) as AdminPaymentSummaryGroupDto[];
  }

  private validateDates(query: SalesSummaryQueryDto): void {
    if (query.from && !isIsoDate(query.from))
      throw new BadRequestException('from debe ser una fecha válida');
    if (query.to && !isIsoDate(query.to))
      throw new BadRequestException('to debe ser una fecha válida');
    if (query.from && query.to && query.from > query.to) {
      throw new BadRequestException('from no puede ser posterior a to');
    }
  }

  private bounds(query: SalesSummaryQueryDto): { from?: Date; to?: Date } {
    return {
      from: query.from ? this.crStart(query.from) : undefined,
      to: query.to ? this.crStart(this.nextDay(query.to)) : undefined,
    };
  }

  private crStart(value: string): Date {
    return new Date(`${value}T06:00:00.000Z`);
  }

  private nextDay(value: string): string {
    const date = new Date(`${value}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }

  private money(value: string): number {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }
}
