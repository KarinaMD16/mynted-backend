import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { OptionalAuthenticatedRequest } from '../auth/types/authenticated-request';
import {
  ApiDisplayCurrencyHeader,
  DisplayCurrency,
} from '../pricing/display-currency.decorator';
import { GetSellerProductsQueryDto } from './dto/get-seller-products-query.dto';
import { SellerStoreDto, SellerTagDto } from './dto/seller-store.dto';
import { SellersPublicService } from './sellers-public.service';

const STORE_NOT_FOUND =
  'La tienda no existe, el vendedor no está aprobado o su cuenta está desactivada';

// Rutas públicas de la tienda. Conviven con las de comisión de
// SellerCommissionController (sellers/me/commission...): estas siempre
// llevan un sellerId numérico.
@ApiTags('sellers')
@ApiBearerAuth()
@UseGuards(OptionalJwtAuthGuard)
@Controller('sellers')
@ApiParam({ name: 'sellerId', type: Number, example: 4 })
@ApiBadRequestResponse({ description: 'sellerId no es un entero' })
@ApiNotFoundResponse({ description: STORE_NOT_FOUND })
export class SellersPublicController {
  constructor(private readonly sellersPublicService: SellersPublicService) {}

  @Get(':sellerId')
  @ApiOperation({
    summary:
      'Perfil público de la tienda: datos del vendedor, rating, ventas, productos activos, antigüedad y tiempo de respuesta. Funciona sin sesión',
  })
  @ApiOkResponse({ type: SellerStoreDto })
  getStore(
    @Param('sellerId', ParseIntPipe) sellerId: number,
  ): Promise<SellerStoreDto> {
    return this.sellersPublicService.getStore(sellerId);
  }

  @Get(':sellerId/products')
  @ApiOperation({
    summary:
      'Productos de la tienda (active por defecto o sold), sin comunidades privadas. Misma forma que GET /products, con displayPrice/displayFinalPrice en la moneda de visualización. ' +
      'Filtros: tag, type, condition, priceMin/priceMax (en la moneda de visualización); sort: recent|newest|price_asc|price_desc',
  })
  @ApiDisplayCurrencyHeader()
  @ApiBadRequestResponse({
    description: 'Query inválida (p. ej. status draft o inactive)',
  })
  findProducts(
    @Param('sellerId', ParseIntPipe) sellerId: number,
    @Query() query: GetSellerProductsQueryDto,
    @Req() request: OptionalAuthenticatedRequest,
    @DisplayCurrency() displayCurrency: string,
  ) {
    return this.sellersPublicService.findProducts(
      sellerId,
      query,
      request.user?.userId,
      displayCurrency,
    );
  }

  @Get(':sellerId/tags')
  @ApiOperation({
    summary:
      'Tags de los productos activos de la tienda (sin comunidades privadas) con su cantidad, de mayor a menor',
  })
  @ApiOkResponse({ type: [SellerTagDto] })
  getTags(
    @Param('sellerId', ParseIntPipe) sellerId: number,
  ): Promise<SellerTagDto[]> {
    return this.sellersPublicService.getTags(sellerId);
  }
}
