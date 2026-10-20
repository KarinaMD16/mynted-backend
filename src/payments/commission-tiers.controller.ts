import {
  Controller,
  Get,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CommissionCatalogService } from './commission/commission-catalog.service';
import { CommissionTiersQueryDto } from './dto/commission-tiers-query.dto';
import {
  CommissionTiersResponseDto,
  SalesTierDisplayDto,
} from './dto/commission-tiers-response.dto';

@ApiTags('commission')
@Controller('commission-tiers')
export class CommissionTiersController {
  constructor(private readonly catalog: CommissionCatalogService) {}

  @Get()
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiQuery({ name: 'currency', required: true, example: 'CRC' })
  @ApiOkResponse({ type: CommissionTiersResponseDto })
  @ApiOperation({ summary: 'Consultar rangos activos de comisión' })
  async getTiers(@Query() query: CommissionTiersQueryDto) {
    const sales = await this.catalog.getSalesTiers();
    const prices = await this.catalog.getPriceTiers(query.currency);
    return {
      currency: query.currency,
      salesTiers: sales.map((tier): SalesTierDisplayDto => ({
        name: tier.name,
        minValue: tier.minValue,
        maxValue: tier.maxValue,
        discount: tier.discount,
      })),
      priceTiers: prices.tiers,
    };
  }
}
