import {
  ExecutionContext,
  Injectable,
  PipeTransform,
  createParamDecorator,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { Request } from 'express';
import { DISPLAY_CURRENCY_HEADER } from './currency';
import { PriceDisplayService } from './price-display.service';

interface DisplayCurrencyInput {
  header: unknown;
  userId: string | undefined;
}

const DisplayCurrencyInput = createParamDecorator(
  (_data: unknown, context: ExecutionContext): DisplayCurrencyInput => {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: { userId?: string } }>();
    return {
      header: request.headers[DISPLAY_CURRENCY_HEADER],
      userId: request.user?.userId,
    };
  },
);

@Injectable()
export class ResolveDisplayCurrencyPipe implements PipeTransform<
  DisplayCurrencyInput,
  Promise<string>
> {
  constructor(private readonly priceDisplay: PriceDisplayService) {}

  transform(input: DisplayCurrencyInput): Promise<string> {
    return this.priceDisplay.resolveCurrency(input.header, input.userId);
  }
}

// Moneda de visualización ya resuelta (header → displayCurrency → currency →
// CRC). Corre después de los guards, así que ve el usuario de la sesión. El
// módulo del controller debe importar PricingModule.
export const DisplayCurrency = () =>
  DisplayCurrencyInput(ResolveDisplayCurrencyPipe);

export const ApiDisplayCurrencyHeader = () =>
  ApiHeader({
    name: 'X-Display-Currency',
    required: false,
    description:
      'Moneda en la que mostrar los precios (ISO 4217 soportado). Si falta o no es válida: displayCurrency del usuario, luego su currency, luego CRC',
  });
