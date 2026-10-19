import { getMetadataArgsStorage } from 'typeorm';
import { CommissionTier } from './commission-tier.entity';
import { PaymentTransaction } from './payment-transaction.entity';
import { TransactionStatus } from '../enums/transaction-status.enum';

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
});
