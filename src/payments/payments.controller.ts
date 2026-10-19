import {
  Body,
  Controller,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { CheckoutDto } from './dto/checkout.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

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
