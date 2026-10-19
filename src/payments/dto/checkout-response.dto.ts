import { TransactionStatus } from '../enums/transaction-status.enum';

export class CheckoutCommissionSnapshotDto {
  salesTierName!: string;
  salesDiscount!: number;
  priceTierName!: string;
  priceDiscount!: number;
  commissionRate!: number;
  commissionAmount!: number;
  sellerNet!: number;
  exchangeRate!: number | null;
  normalizedAmountCrc!: number | null;
}

export class CheckoutResponseDto {
  id!: string;
  status!: TransactionStatus;
  amount!: number;
  currency!: string;
  commission!: CheckoutCommissionSnapshotDto;
  gatewayReference!: string | null;
  cardBrand!: string | null;
  cardLast4!: string | null;
  failureReason!: string | null;
  completedAt!: Date | null;
}
