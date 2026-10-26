import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import {
  ApiDisplayCurrencyHeader,
  DisplayCurrency,
} from '../pricing/display-currency.decorator';
import { SubscriptionCheckoutDto } from './dto/subscription-checkout.dto';
import { SubscriptionPaymentsQueryDto } from './dto/subscription-payments-query.dto';
import {
  MySubscriptionDto,
  SubscriptionPaymentDto,
  SubscriptionPaymentListResponseDto,
  SubscriptionPlansResponseDto,
} from './dto/subscription-response.dto';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('plans')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiDisplayCurrencyHeader()
  @ApiOperation({
    summary:
      'Planes Pro con su precio en USD (lo que se cobra) y en la moneda del usuario (informativo). Funciona sin sesión',
  })
  @ApiOkResponse({ type: SubscriptionPlansResponseDto })
  plans(@DisplayCurrency() displayCurrency: string) {
    return this.subscriptionsService.getPlans(displayCurrency);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Estado de mi suscripción Pro (status: none, active, cancelled o expired)',
  })
  @ApiOkResponse({ type: MySubscriptionDto })
  me(@Req() request: AuthenticatedRequest) {
    return this.subscriptionsService.getMine(request.user.userId);
  }

  @Get('me/payments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Historial paginado de mis pagos de suscripción (más reciente primero)',
  })
  @ApiOkResponse({ type: SubscriptionPaymentListResponseDto })
  payments(
    @Query() query: SubscriptionPaymentsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.subscriptionsService.listPayments(request.user.userId, query);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Cancelar la renovación: sigue siendo Pro hasta endsAt. No hay cobro automático; pagar de nuevo la reactiva',
  })
  @ApiOkResponse({ type: MySubscriptionDto })
  @ApiConflictResponse({ description: 'No tienes una suscripción Pro vigente' })
  cancel(@Req() request: AuthenticatedRequest) {
    return this.subscriptionsService.cancel(request.user.userId);
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiDisplayCurrencyHeader()
  @ApiBody({
    type: SubscriptionCheckoutDto,
    examples: {
      annual: {
        summary: 'Pago anual aprobado',
        value: {
          period: 'annual',
          card: {
            cardNumber: '4242424242424242',
            expiryMonth: 12,
            expiryYear: 2099,
            cvv: '123',
            cardHolderName: 'María José Núñez',
          },
        },
      },
    },
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Clave única de la operación, entre 8 y 128 caracteres',
  })
  @ApiOperation({
    summary:
      'Pagar (o renovar) Pro. Si ya está vigente, extiende desde endsAt; si venció, desde ahora',
  })
  @ApiResponse({ status: 201, type: SubscriptionPaymentDto })
  @ApiResponse({
    status: 400,
    description: 'Tarjeta o Idempotency-Key inválidas',
  })
  @ApiResponse({ status: 402, description: 'Pago rechazado (failureReason)' })
  @ApiConflictResponse({
    description: 'La clave de idempotencia pertenece a otra operación',
  })
  @ApiResponse({ status: 503, description: 'Pasarela no disponible' })
  checkout(
    @Body() dto: SubscriptionCheckoutDto,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
    @DisplayCurrency() displayCurrency: string,
  ) {
    return this.subscriptionsService.checkout(
      request.user.userId,
      dto,
      idempotencyKey,
      displayCurrency,
    );
  }
}
