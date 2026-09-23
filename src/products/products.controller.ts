import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
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
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductStatusDto } from './dto/update-product-status.dto';
import { GetProductsQueryDto } from './dto/get-products-query.dto';
import { GetRecommendedProductsQueryDto } from './dto/get-recommended-products-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { SellerGuard } from '../auth/guards/seller.guard';
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

@ApiTags('products')
@Controller()
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post('communities/:communityId/products')
  @UseGuards(JwtAuthGuard, SellerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publicar un producto en una comunidad' })
  @ApiParam({ name: 'communityId', type: Number, example: 5 })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'title',
        'description',
        'price',
        'type',
        'condition',
        'tagIds',
        'image',
      ],
      properties: {
        title: {
          type: 'string',
          example: 'Figura de Charizard Funko Pop #123',
        },
        description: {
          type: 'string',
          example: 'Figura original, caja sellada, sin abrir',
        },
        price: { type: 'number', example: 25.99 },
        type: {
          type: 'string',
          enum: ['sale', 'exchange'],
          example: 'sale',
        },
        condition: {
          type: 'string',
          enum: ['new', 'like_new', 'good_condition', 'used_with_details'],
          example: 'new',
        },
        tagIds: {
          type: 'array',
          items: { type: 'integer' },
          example: [1, 3, 5],
          minItems: 3,
          maxItems: 3,
          description:
            'Debe traer exactamente 3 tags. En multipart/form-data puede enviarse como arreglo JSON',
        },
        image: {
          type: 'string',
          format: 'binary',
          description: 'Imagen de portada (obligatoria)',
        },
        images: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description:
            'Imágenes adicionales para la galería del detalle (opcional)',
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
      'devuelve los productos activos más recientes',
  })
  findRecommended(
    @Req() request: OptionalAuthenticatedRequest,
    @Query() query: GetRecommendedProductsQueryDto,
  ) {
    return this.productsService.findRecommended(request.user?.userId, query);
  }

  @Get('products')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Listar/buscar productos activos con filtros combinables (comunidad, tag, categoría, type, condition, rango de precio)',
  })
  findAll(@Query() query: GetProductsQueryDto) {
    return this.productsService.findAll(query);
  }

  @Get('products/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener el detalle de un producto' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.findOne(id);
  }

  @Get('products/:id/related')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Productos relacionados: comparten tag o comunidad con el producto actual',
  })
  findRelated(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.findRelated(id);
  }

  @Patch('products/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Editar un producto propio' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          example: 'Figura de Charizard Funko Pop #123',
        },
        description: {
          type: 'string',
          example: 'Figura original, caja sellada, sin abrir',
        },
        price: { type: 'number', example: 22.5 },
        type: {
          type: 'string',
          enum: ['sale', 'exchange'],
          example: 'sale',
        },
        condition: {
          type: 'string',
          enum: ['new', 'like_new', 'good_condition', 'used_with_details'],
          example: 'like_new',
        },
        tagIds: {
          type: 'array',
          items: { type: 'integer' },
          example: [1, 3, 5],
          minItems: 3,
          maxItems: 3,
          description:
            'Reemplaza por completo los tags. Debe traer exactamente 3 si se incluye. En multipart/form-data puede enviarse como arreglo JSON',
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

  @Patch('products/:id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cambiar el status de un producto propio' })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.productsService.updateStatus(id, request.user.userId, dto);
  }
}
