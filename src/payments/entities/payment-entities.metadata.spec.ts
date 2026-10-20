import { getMetadataArgsStorage } from 'typeorm';
import { CommissionTier } from './commission-tier.entity';
import { PaymentTransaction } from './payment-transaction.entity';
import { TransactionStatus } from '../enums/transaction-status.enum';
import { ExchangeRateSnapshot } from './exchange-rate-snapshot.entity';

describe('payment entity metadata', () => {
  it('maps PaymentTransaction to its historical table and constraints', () => {
    const entity = getMetadataArgsStorage().tables.find(
      (table) => table.target === PaymentTransaction,
    );
    const unique = getMetadataArgsStorage().uniques.find(
      (constraint) => constraint.target === PaymentTransaction,
    );

    expect(entity?.name).toBe('payment_transaction');
    expect(unique?.name).toBe('UQ_payment_transaction_idempotency_key');
    expect(unique?.columns).toEqual(['idempotencyKey']);
    expect(TransactionStatus.REFUNDED).toBe('refunded');
  });

  it('maps CommissionTier to a configurable catalog table', () => {
    const entity = getMetadataArgsStorage().tables.find(
      (table) => table.target === CommissionTier,
    );

    expect(entity?.name).toBe('commission_tier');
  });

  it('maps exchange snapshots with provider-specific identity and nullable BCCR metadata', () => {
    const entity = getMetadataArgsStorage().tables.find(
      (table) => table.target === ExchangeRateSnapshot,
    );
    const unique = getMetadataArgsStorage().uniques.find(
      (constraint) => constraint.target === ExchangeRateSnapshot,
    );
    const indicator = getMetadataArgsStorage().columns.find(
      (column) =>
        column.target === ExchangeRateSnapshot &&
        column.propertyName === 'indicatorCode',
    );

    expect(entity?.name).toBe('exchange_rate_snapshot');
    expect(unique?.name).toBe(
      'UQ_exchange_rate_snapshot_source_pair_type_date',
    );
    expect(unique?.columns).toEqual([
      'fromCurrency',
      'toCurrency',
      'source',
      'rateType',
      'rateDate',
    ]);
    expect(indicator?.options.nullable).toBe(true);
  });
});
