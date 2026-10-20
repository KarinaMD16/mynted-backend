import { PaymentCardData } from './payment-card.types';
import { PaymentFailureReason } from './payment-failure-reason.enum';

export interface PaymentGatewayChargeInput {
  amount: number;
  currency: string;
  card: PaymentCardData;
}

export type PaymentGatewayResult =
  | {
      approved: true;
      gatewayReference: string;
      cardBrand: string;
      cardLast4: string;
    }
  | {
      approved: false;
      failureReason: PaymentFailureReason;
    };

export interface PaymentGateway {
  charge(input: PaymentGatewayChargeInput): Promise<PaymentGatewayResult>;
}
