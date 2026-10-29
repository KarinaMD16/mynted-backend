import { TransactionStatus } from '../enums/transaction-status.enum';
import { ShippingAddressSnapshot } from '../types/shipping-address-snapshot';

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
  // Unidades compradas y precio unitario; amount es el total (unitPrice × quantity).
  quantity!: number;
  unitPrice!: number | null;
  amount!: number;
  currency!: string;
  commission!: CheckoutCommissionSnapshotDto;
  gatewayReference!: string | null;
  cardBrand!: string | null;
  cardLast4!: string | null;
  cardHolderName!: string | null;
  failureReason!: string | null;
  completedAt!: Date | null;
  shippingAddress!: ShippingAddressSnapshot | null;
}
