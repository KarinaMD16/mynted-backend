import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ProductsService } from './products.service';
import {
  FeaturedProductResponseDto,
  FeaturedSummaryDto,
} from './dto/featured-product.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductStatusDto } from './dto/update-product-status.dto';
import { ProductAdminActionDto } from './dto/product-admin-action.dto';
import { DeleteProductDto } from './dto/delete-product.dto';
import { GetProductsQueryDto } from './dto/get-products-query.dto';
import { GetRecommendedProductsQueryDto } from './dto/get-recommended-products-query.dto';
import { GetShopQueryDto } from './dto/get-shop-query.dto';
import { GetMyProductsQueryDto } from './dto/get-my-products-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { SellerGuard } from '../auth/guards/seller.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import {
  ApiDisplayCurrencyHeader,
  DisplayCurrency,
} from '../pricing/display-currency.decorator';
import {
  AuthenticatedRequest,
  OptionalAuthenticatedRequest,
} from '../auth/types/authenticated-request';

const IMAGE_FILE_SIZE_LIMIT = 5 * 1024 * 1024;
const MAX_GALLERY_IMAGES = 6;

interface ProductFiles {
  image?: Express.Multer.File[];
  images?: Express.Multer.File[];
}

// Campos comunes del multipart de crear/editar (solo para Swagger UI).
const PRODUCT_BODY_PROPERTIES = {
  title: {
    type: 'string',
    example: 'Figura de Charizard Funko Pop #123',
  },
  description: {
    type: 'string',
    example: 'Figura original, caja sellada, sin abrir',
  },
  price: { type: 'number', example: 25.99 },
  discountPercent: {
    type: 'number',
    example: 15,
    minimum: 0,
    maximum: 100,
    description:
      'No modifica price: la respuesta trae finalPrice (precio con descuento)',
  },
  type: { type: 'string', enum: ['sale', 'exchange'], example: 'sale' },
  condition: {
    type: 'string',
    enum: ['new', 'like_new', 'good_condition', 'used_with_details'],
    example: 'new',
  },
  isVisible: {
    type: 'boolean',
    example: true,
    description: 'false oculta el producto de los listados públicos',
  },
  shipsTo: {
    type: 'array',
    items: { type: 'string' },
    example: ['CR', 'MX'],
    description:
      'Países de envío (ISO 3166-1 alfa-2). Puede enviarse como arreglo JSON o lista separada por comas',
  },
  relatedProductIds: {
    type: 'array',
    items: { type: 'integer' },
    example: [10, 11],
    maxItems: 6,
    description:
      'Productos relacionados elegidos por el vendedor (máximo 6, tuyos y activos)',
  },
};

// Multipart de crear producto (compartido por las dos rutas de publicación).
function CreateProductMultipart() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: ['title'],
        properties: {
          ...PRODUCT_BODY_PROPERTIES,
          tagIds: {
            type: 'array',
            items: { type: 'integer' },
            example: [1, 3, 5],
            maxItems: 3,
            description:
              'Al publicar debe traer exactamente 3 tags; un borrador puede traer hasta 3. En multipart/form-data puede enviarse como arreglo JSON',
          },
          saveAsDraft: {
            type: 'boolean',
            example: false,
            description:
              'true guarda un borrador (solo exige title); se publica luego con POST /products/:id/publish',
          },
          image: {
            type: 'string',
            format: 'binary',
            description: 'Imagen de portada (obligatoria al publicar)',
          },
          images: {
            type: 'array',
            items: { type: 'string', format: 'binary' },
            description:
              'Imágenes adicionales para la galería del detalle (opcional)',
          },
        },
      },
    }),
    UseInterceptors(
      FileFieldsInterceptor(
        [
          { name: 'image', maxCount: 1 },
          { name: 'images', maxCount: MAX_GALLERY_IMAGES },
        ],
        { limits: { fileSize: IMAGE_FILE_SIZE_LIMIT } },
      ),
    ),
  );
}

@ApiTags('products')
@Controller()
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post('products')
  @UseGuards(JwtAuthGuard, SellerGuard)
  @CreateProductMultipart()
  @ApiOperation({
    summary:
      'Publicar un producto SIN comunidad (o guardarlo como borrador con saveAsDraft=true). ' +
      'Requiere rol vendedor. Al publicar son obligatorios description, price, type, condition, 3 tags e image',
  })
  createWithoutCommunity(
    @Body(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    dto: CreateProductDto,
    @UploadedFiles() files: ProductFiles,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.productsService.create(
      null,
      request.user.userId,
      dto,
      files?.image?.[0],
      files?.images,
    );
  }

  @Post('communities/:communityId/products')
  @UseGuards(JwtAuthGuard, SellerGuard)
  @CreateProductMultipart()
  @ApiOperation({
    summary:
      'Publicar un producto EN una comunidad (o guardarlo como borrador con saveAsDraft=true). ' +
      'Requiere rol vendedor y ser miembro de esa comunidad. Mismos campos que POST /products',
  })
  @ApiParam({ name: 'communityId', type: Number, example: 5 })
  create(
    @Param('communityId', ParseIntPipe) communityId: number,
    @Body(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    dto: CreateProductDto,
    @UploadedFiles() files: ProductFiles,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.productsService.create(
      communityId,
      request.user.userId,
      dto,
      files?.image?.[0],
      files?.images,
    );
  }

  @Get('products/recommended')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Productos recomendados: combina los tags que sigue el usuario autenticado (si hay uno) ' +
      'y/o los tags y comunidad de currentProductId (si se pasa). Sin ninguna señal, ' +
      'devuelve los productos activos más recientes. Funciona sin sesión. Cada producto trae displayPrice/displayFinalPrice en la moneda de visualización',
  })
  @ApiDisplayCurrencyHeader()
  findRecommended(
    @Req() request: OptionalAuthenticatedRequest,
    @Query() query: GetRecommendedProductsQueryDto,
    @DisplayCurrency() displayCurrency: string,
  ) {
    return this.productsService.findRecommended(
      request.user?.userId,
      query,
      displayCurrency,
    );
  }

  @Get('products/shop')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Pantalla Shop con scroll infinito: una sección por tag (page/limit paginan las secciones; ' +
      'productsPage/productsLimit los productos de cada una). Con usuario autenticado primero van los tags de sus intereses; ' +
      'sin usuario o sin intereses, los más populares. shipTo filtra por país de envío; priceMin/priceMax (en la moneda de visualización) y sort ordenan/filtran los productos de cada sección',
  })
  @ApiDisplayCurrencyHeader()
  findShop(
    @Req() request: OptionalAuthenticatedRequest,
    @Query() query: GetShopQueryDto,
    @DisplayCurrency() displayCurrency: string,
  ) {
    return this.productsService.findShop(
      request.user?.userId,
      query,
      displayCurrency,
    );
  }

  @Get('products/me')
  @UseGuards(JwtAuthGuard, SellerGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Productos del vendedor autenticado (cualquier estado, borradores incluidos), agrupados por tag. ' +
      'Filtros opcionales: status (draft|active|inactive|sold), q (título), type, condition, priceMin, priceMax, tagId. ' +
      'page/limit paginan las secciones; productsPage/productsLimit los productos dentro de cada una',
  })
  findMine(
    @Req() request: AuthenticatedRequest,
    @Query() query: GetMyProductsQueryDto,
  ) {
    return this.productsService.findMine(request.user.userId, query);
  }

  @Get('products/me/stats')
  @UseGuards(JwtAuthGuard, SellerGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Contadores de los productos del vendedor autenticado por estado (draft, active, sold, inactive) y total',
  })
  countMine(@Req() request: AuthenticatedRequest) {
    return this.productsService.countMineByStatus(request.user.userId);
  }

  @Get('products/me/featured/summary')
  @UseGuards(JwtAuthGuard, SellerGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Destacados del vendedor autenticado: tope, cuántos están en uso (efectivos ahora) y cuántos le quedan',
  })
  @ApiOkResponse({ type: FeaturedSummaryDto })
  featuredSummary(@Req() request: AuthenticatedRequest) {
    return this.productsService.getFeaturedSummary(request.user.userId);
  }

  @Put('products/:id/featured')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'id', type: Number, example: 42 })
  @ApiOperation({
    summary:
      'Destacar un producto propio (vendedor aprobado con Pro vigente; hasta 3 destacados efectivos). Idempotente: si ya estaba destacado responde 200 sin cambiar la fecha',
  })
  @ApiOkResponse({ type: FeaturedProductResponseDto })
  @ApiNotFoundResponse({ description: 'No existe o no es tuyo' })
  @ApiForbiddenResponse({
    description: 'No eres vendedor aprobado o no tienes Pro vigente',
  })
  @ApiConflictResponse({
    description: 'El producto no está activo o ya tienes 3 destacados',
  })
  setFeatured(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.productsService.setFeatured(id, request.user.userId);
  }

  @Delete('products/:id/featured')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'id', type: Number, example: 42 })
  @ApiOperation({
    summary:
      'Quitar el destacado de un producto propio. Idempotente; no exige Pro',
  })
  @ApiNoContentResponse({ description: 'Sin destacado' })
  @ApiNotFoundResponse({ description: 'No existe o no es tuyo' })
  async unsetFeatured(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.productsService.unsetFeatured(id, request.user.userId);
  }

  @Get('products')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Listar/buscar productos activos y visibles con filtros combinables (comunidad, tag, categoría, type, condition, currency, rango de precio final, país de envío) y sort (newest|price_asc|price_desc). ' +
      'priceMin/priceMax se interpretan en la moneda de visualización. Funciona sin sesión; con sesión cada producto trae isSaved',
  })
  @ApiDisplayCurrencyHeader()
  findAll(
    @Query() query: GetProductsQueryDto,
    @Req() request: OptionalAuthenticatedRequest,
    @DisplayCurrency() displayCurrency: string,
  ) {
    return this.productsService.findAll(
      query,
      request.user?.userId,
      displayCurrency,
    );
  }

  @Get('products/:id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Detalle de un producto: precio, descuento y precio final, rating, datos públicos del vendedor (userId, foto y rating), isSaved, ' +
      'canReview (true si quien mira puede reseñarlo: con sesión, no es el dueño, no es exchange, tiene una compra completed y aún no lo reseñó), ' +
      'hasReviewed y reviewId (su reseña propia, para "editar tu reseña"). Sin sesión: canReview false, hasReviewed false y reviewId null. ' +
      'canComment es el nombre anterior de canReview (deprecado, mismo valor). Funciona sin sesión; un borrador solo lo ve su dueño',
  })
  @ApiOkResponse({
    description: 'Detalle del producto (se listan solo los campos de reseñas)',
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        canReview: {
          type: 'boolean',
          example: true,
          description:
            'true solo si: hay sesión, compró el producto (pago completed), no lo ha reseñado, no es el vendedor y no es de tipo exchange',
        },
        canComment: {
          type: 'boolean',
          example: true,
          deprecated: true,
          description: 'Deprecado: alias de canReview (mismo valor)',
        },
        hasReviewed: { type: 'boolean', example: false },
        reviewId: { type: 'integer', nullable: true, example: null },
      },
    },
  })
  @ApiDisplayCurrencyHeader()
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: OptionalAuthenticatedRequest,
    @DisplayCurrency() displayCurrency: string,
  ) {
    return this.productsService.findDetail(
      id,
      request.user?.userId,
      displayCurrency,
    );
  }

  @Get('products/:id/related')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Productos relacionados: primero los elegidos por el vendedor (isSellerChoice) y luego los automáticos por tags y comunidad',
  })
  @ApiDisplayCurrencyHeader()
  findRelated(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: OptionalAuthenticatedRequest,
    @DisplayCurrency() displayCurrency: string,
  ) {
    return this.productsService.findRelated(
      id,
      request.user?.userId,
      displayCurrency,
    );
  }

  @Patch('products/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Editar un producto propio (publicado o borrador). También permite mover el producto de comunidad (communityId) o dejarlo sin comunidad (communityId=null)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        ...PRODUCT_BODY_PROPERTIES,
        tagIds: {
          type: 'array',
          items: { type: 'integer' },
          example: [1, 3, 5],
          maxItems: 3,
          description:
            'Reemplaza por completo los tags. Un producto publicado debe quedar con exactamente 3; un borrador, con hasta 3. En multipart/form-data puede enviarse como arreglo JSON',
        },
        communityId: {
          type: 'integer',
          nullable: true,
          example: 5,
          description:
            'Mueve el producto a esta comunidad (debes ser miembro). El texto "null" lo deja sin comunidad. Si se omite, no cambia',
        },
        image: {
          type: 'string',
          format: 'binary',
          description: 'Nueva imagen de portada (opcional)',
        },
        images: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description:
            'Reemplaza por completo la galería. Si se omite, la galería existente no se toca',
        },
      },
    },
  })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'image', maxCount: 1 },
        { name: 'images', maxCount: MAX_GALLERY_IMAGES },
      ],
      { limits: { fileSize: IMAGE_FILE_SIZE_LIMIT } },
    ),
  )
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    dto: UpdateProductDto,
    @UploadedFiles() files: ProductFiles,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.productsService.update(
      id,
      request.user.userId,
      dto,
      files?.image?.[0],
      files?.images,
    );
  }

  @Post('products/:id/view')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Registrar que el usuario vio este producto (alimenta las recomendaciones). Las vistas del propio vendedor no cuentan',
  })
  async recordView(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.productsService.recordView(id, request.user.userId);
  }

  @Post('products/:id/publish')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, SellerGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Publicar un borrador propio: valida description, price, type, condition, 3 tags e imagen, y lo pasa a active',
  })
  publish(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.productsService.publish(id, request.user.userId);
  }

  @Patch('products/:id/deactivate')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '[Superadmin] Desactivar administrativamente un producto',
  })
  deactivate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ProductAdminActionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.productsService.deactivateByAdmin(id, request.user.userId, dto);
  }

  @Patch('products/:id/activate')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '[Superadmin] Retirar la desactivación administrativa',
  })
  activate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ProductAdminActionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.productsService.activateByAdmin(id, request.user.userId, dto);
  }

  @Patch('products/:id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Cambiar el status de un producto propio. active reactiva uno inactive (o publica un borrador); un sold no puede volver a active',
  })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.productsService.updateStatus(id, request.user.userId, dto);
  }

  @Delete('products/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Borrar un producto propio (borrado lógico: se conservan favoritos y conversaciones; los listados lo ignoran)',
  })
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeleteProductDto,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.productsService.remove(id, request.user.userId, dto);
  }
}
