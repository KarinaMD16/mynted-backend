import {
  Body,
  Controller,
  Headers,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Optional,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { CheckoutDto } from './dto/checkout.dto';
import { PaymentsService } from './payments.service';
import { QuoteResponseDto } from './dto/quote-response.dto';
import { PaymentHistoryService } from './payment-history.service';
import { PaymentHistoryQueryDto } from './dto/payment-history-query.dto';
import { SalesSummaryQueryDto } from './dto/sales-summary-query.dto';
import { PaymentPurchaseListResponseDto } from './dto/payment-purchase-response.dto';
import { PaymentSaleListResponseDto } from './dto/payment-sale-response.dto';
import { SalesSummaryResponseDto } from './dto/sales-summary-response.dto';
import { PaymentReceiptResponseDto } from './dto/payment-receipt-response.dto';
import { ShipPaymentDto } from './dto/ship-payment.dto';
import { PaymentShippingResponseDto } from './dto/payment-shipping-response.dto';
import { CancelPaymentDto } from './dto/cancel-payment.dto';
import { PaymentCancelResponseDto } from './dto/payment-cancel-response.dto';
import { CreatePaymentDisputeDto } from './dto/create-payment-dispute.dto';
import { ResolvePaymentDisputeDto } from './dto/resolve-payment-dispute.dto';
import { PaymentDisputeQueryDto } from './dto/payment-dispute-query.dto';
import {
  PaymentDisputeItemDto,
  PaymentDisputeListResponseDto,
} from './dto/payment-dispute-response.dto';
import { PaymentDisputesService } from './payment-disputes.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    @Optional() private readonly paymentHistoryService?: PaymentHistoryService,
    @Optional()
    private readonly paymentDisputesService?: PaymentDisputesService,
  ) {}

  @Get('me/purchases')
  @UseGuards(JwtAuthGuard)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Historial de compras completadas del usuario' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiOkResponse({ type: PaymentPurchaseListResponseDto })
  purchases(
    @Query() query: PaymentHistoryQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentHistoryService!.purchases(request.user.userId, query);
  }

  @Get('me/sales')
  @UseGuards(JwtAuthGuard)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Historial de ventas completadas del vendedor' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiOkResponse({ type: PaymentSaleListResponseDto })
  sales(
    @Query() query: PaymentHistoryQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentHistoryService!.sales(request.user.userId, query);
  }

  @Get('me/sales/summary')
  @UseGuards(JwtAuthGuard)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resumen de ventas completadas del vendedor' })
  @ApiQuery({ name: 'from', required: false, example: '2026-01-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-01-31' })
  @ApiOkResponse({ type: SalesSummaryResponseDto })
  salesSummary(
    @Query() query: SalesSummaryQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentHistoryService!.salesSummary(request.user.userId, query);
  }

  @Get('quote/:productId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'productId', type: Number, example: 42 })
  @ApiOkResponse({ type: QuoteResponseDto })
  @ApiResponse({
    status: 403,
    description:
      'Primero conversa con el vendedor antes de comprar este producto',
  })
  @ApiQuery({
    name: 'quantity',
    required: false,
    type: Number,
    example: 2,
    description: 'Unidades a cotizar (por defecto 1, máximo el stock)',
  })
  @ApiOperation({ summary: 'Cotizar un producto antes del checkout' })
  quote(
    @Param('productId', ParseIntPipe) productId: number,
    @Req() request: AuthenticatedRequest,
    @Query('quantity', new ParseIntPipe({ optional: true }))
    quantity?: number,
  ) {
    return this.paymentsService.quote(productId, request.user.userId, quantity);
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiBody({
    type: CheckoutDto,
    examples: {
      approved: {
        summary: 'Ejemplo de checkout aprobado',
        value: {
          productId: 42,
          card: {
            cardNumber: '4242424242424242',
            expiryMonth: 12,
            expiryYear: 2027,
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
  @ApiOperation({ summary: 'Procesar el checkout de un producto de venta' })
  @ApiResponse({
    status: 409,
    description:
      'El producto no estÃ¡ disponible para envÃ­o al paÃ­s indicado',
  })
  @ApiResponse({
    status: 403,
    description:
      'Primero conversa con el vendedor antes de comprar este producto',
  })
  checkout(
    @Body() dto: CheckoutDto,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentsService.checkout(
      dto,
      request.user.userId,
      idempotencyKey,
    );
  }

  @Patch(':id/ship')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: ShipPaymentDto })
  @ApiOperation({ summary: 'Marcar una compra como enviada' })
  @ApiOkResponse({ type: PaymentShippingResponseDto })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No es el vendedor de la compra' })
  @ApiResponse({ status: 404, description: 'Transacción no encontrada' })
  @ApiResponse({ status: 409, description: 'Estado no válido para envío' })
  ship(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ShipPaymentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentsService.ship(id, request.user.userId, dto);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: CancelPaymentDto })
  @ApiOperation({ summary: 'Cancelar una compra antes del envío' })
  @ApiOkResponse({ type: PaymentCancelResponseDto })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No es el vendedor de la compra' })
  @ApiResponse({ status: 404, description: 'Transacción no encontrada' })
  @ApiResponse({
    status: 409,
    description: 'Estado no válido para cancelación',
  })
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelPaymentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentsService.cancel(id, request.user.userId, dto);
  }

  @Post(':id/dispute')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: CreatePaymentDisputeDto })
  @ApiOperation({ summary: 'Abrir un reclamo de una compra entregada' })
  @ApiOkResponse({ type: PaymentDisputeItemDto })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No es el comprador de la compra' })
  @ApiResponse({ status: 404, description: 'Transacción no encontrada' })
  @ApiResponse({
    status: 409,
    description: 'Estado no válido o reclamo duplicado',
  })
  dispute(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreatePaymentDisputeDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentDisputesService!.create(id, request.user.userId, dto);
  }

  @Get('disputes')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar reclamos comerciales' })
  @ApiOkResponse({ type: PaymentDisputeItemDto })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'Requiere permisos de superadministrador',
  })
  disputes(@Query() query: PaymentDisputeQueryDto) {
    return this.paymentDisputesService!.findAll(query);
  }

  @Get('disputes/:id')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOperation({ summary: 'Consultar un reclamo comercial' })
  @ApiOkResponse({ type: PaymentDisputeItemDto })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'Requiere permisos de superadministrador',
  })
  @ApiResponse({ status: 404, description: 'Reclamo no encontrado' })
  disputeDetail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.paymentDisputesService!.findById(id);
  }

  @Patch('disputes/:id/resolve')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: ResolvePaymentDisputeDto })
  @ApiOperation({ summary: 'Resolver un reclamo comercial' })
  @ApiOkResponse({ type: PaymentDisputeListResponseDto })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'Requiere permisos de superadministrador',
  })
  @ApiResponse({ status: 404, description: 'Reclamo no encontrado' })
  @ApiResponse({ status: 409, description: 'El reclamo ya fue resuelto' })
  resolveDispute(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ResolvePaymentDisputeDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentDisputesService!.resolve(id, request.user.userId, dto);
  }

  @Patch(':id/deliver')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOperation({ summary: 'Marcar una compra como entregada' })
  @ApiOkResponse({ type: PaymentShippingResponseDto })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No es el comprador de la compra' })
  @ApiResponse({ status: 404, description: 'Transacción no encontrada' })
  @ApiResponse({ status: 409, description: 'Estado no válido para entrega' })
  deliver(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentsService.deliver(id, request.user.userId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOperation({
    summary: 'Consultar el recibo de una transacción autorizada',
  })
  @ApiOkResponse({ type: PaymentReceiptResponseDto })
  receipt(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentHistoryService!.receipt(request.user.userId, id);
  }
}
