import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { SalesSummaryQueryDto } from './dto/sales-summary-query.dto';
import { AdminPaymentSummaryService } from './admin-payment-summary.service';
import { AdminPaymentSummaryResponseDto } from './dto/admin-payment-summary-response.dto';

@ApiTags('admin/payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(private readonly service: AdminPaymentSummaryService) {}

  @Get('summary')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiQuery({ name: 'from', required: false, example: '2026-01-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-01-31' })
  @ApiOkResponse({ type: AdminPaymentSummaryResponseDto })
  @ApiOperation({ summary: 'Resumen administrativo de comisiones cobradas' })
  summary(@Query() query: SalesSummaryQueryDto) {
    return this.service.summary(query);
  }
}
