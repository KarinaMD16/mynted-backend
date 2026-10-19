import {
  Controller,
  Get,
  Query,
  Req,
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
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SellerGuard } from '../auth/guards/seller.guard';
import { CommissionEstimateQueryDto } from './dto/commission-estimate-query.dto';
import { CommissionEstimateResponseDto } from './dto/commission-estimate-response.dto';
import { SellersService } from './sellers.service';

@ApiTags('sellers')
@Controller('sellers')
export class SellerCommissionController {
  constructor(private readonly sellersService: SellersService) {}

  @Get('me/commission/estimate')
  @UseGuards(JwtAuthGuard, SellerGuard)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiBearerAuth()
  @ApiQuery({
    name: 'amount',
    required: true,
    type: Number,
    example: 120000,
  })
  @ApiOkResponse({ type: CommissionEstimateResponseDto })
  @ApiOperation({
    summary: 'Estimar comisión y neto del vendedor para un monto',
  })
  estimate(
    @Query() query: CommissionEstimateQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<CommissionEstimateResponseDto> {
    return this.sellersService.estimateCommission(
      request.user.userId,
      query.amount,
    );
  }
}
