import {
  Body,
  Controller,
  Headers,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { CheckoutDto } from './dto/checkout.dto';
import { PaymentsService } from './payments.service';
import { QuoteResponseDto } from './dto/quote-response.dto';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('quote/:productId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'productId', type: Number, example: 42 })
  @ApiOkResponse({ type: QuoteResponseDto })
  @ApiOperation({ summary: 'Cotizar un producto antes del checkout' })
  quote(
    @Param('productId', ParseIntPipe) productId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentsService.quote(productId, request.user.userId);
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
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
}
