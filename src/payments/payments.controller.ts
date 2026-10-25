import {
  Body,
  Controller,
  Headers,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
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
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    @Optional() private readonly paymentHistoryService?: PaymentHistoryService,
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
