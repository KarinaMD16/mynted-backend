import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  detectCardBrand,
  isValidCvv,
  isValidExpiry,
  isValidLuhn,
  normalizeCardNumber,
  PaymentCardValidationCode,
  PaymentCardValidationError,
} from './card-validation';
import { SIMULATED_GATEWAY_DELAY_MS } from './payment-gateway.constants';
import {
  PaymentGateway,
  PaymentGatewayChargeInput,
  PaymentGatewayResult,
} from './payment-gateway.interface';
import { PaymentFailureReason } from './payment-failure-reason.enum';

const APPROVED_CARD = '4242424242424242';
const DECLINED_CARD = '4000000000000002';
const INSUFFICIENT_FUNDS_CARD = '4000000000009995';
const EXPIRED_CARD = '4000000000000069';

@Injectable()
export class SimulatedPaymentGateway implements PaymentGateway {
  async charge(
    input: PaymentGatewayChargeInput,
  ): Promise<PaymentGatewayResult> {
    this.validateInput(input);
    const cardNumber = normalizeCardNumber(input.card.cardNumber);
    this.validateCard(cardNumber, input);

    await this.delay(SIMULATED_GATEWAY_DELAY_MS);

    if (cardNumber === APPROVED_CARD) {
      return {
        approved: true,
        gatewayReference: `SIM-${randomBytes(3).toString('hex').toUpperCase()}`,
        cardBrand: detectCardBrand(cardNumber),
        cardLast4: cardNumber.slice(-4),
      };
    }
    if (cardNumber === INSUFFICIENT_FUNDS_CARD) {
      return {
        approved: false,
        failureReason: PaymentFailureReason.INSUFFICIENT_FUNDS,
      };
    }
    if (cardNumber === EXPIRED_CARD) {
      return {
        approved: false,
        failureReason: PaymentFailureReason.EXPIRED_CARD,
      };
    }
    if (cardNumber === DECLINED_CARD) {
      return {
        approved: false,
        failureReason: PaymentFailureReason.CARD_DECLINED,
      };
    }
    return {
      approved: false,
      failureReason: PaymentFailureReason.CARD_DECLINED,
    };
  }

  private validateInput(input: PaymentGatewayChargeInput): void {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new TypeError('Invalid payment amount');
    }
    if (typeof input.currency !== 'string' || input.currency.trim() === '') {
      throw new TypeError('Invalid payment currency');
    }
  }

  private validateCard(
    cardNumber: string,
    input: PaymentGatewayChargeInput,
  ): void {
    if (
      cardNumber.length < 12 ||
      cardNumber.length > 19 ||
      !isValidLuhn(cardNumber)
    ) {
      throw new PaymentCardValidationError(
        PaymentCardValidationCode.INVALID_CARD_NUMBER,
      );
    }
    if (!isValidExpiry(input.card.expiryMonth, input.card.expiryYear)) {
      throw new PaymentCardValidationError(
        PaymentCardValidationCode.INVALID_EXPIRY,
      );
    }
    if (!isValidCvv(input.card.cvv)) {
      throw new PaymentCardValidationError(
        PaymentCardValidationCode.INVALID_CVV,
      );
    }
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
