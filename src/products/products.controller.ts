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
import { GetCommunityProductsQueryDto } from './dto/get-community-products-query.dto';
import { ExploreProductsQueryDto } from './dto/explore-products-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SellerGuard } from '../auth/guards/seller.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';

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
      required: ['title', 'description', 'price', 'tagIds', 'image'],
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

  @Get('communities/:communityId/products')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar productos activos de una comunidad' })
  @ApiParam({ name: 'communityId', type: Number, example: 5 })
  findAllByCommunity(
    @Param('communityId', ParseIntPipe) communityId: number,
    @Query() query: GetCommunityProductsQueryDto,
  ) {
    return this.productsService.findAllByCommunity(communityId, query);
  }

  @Get('products')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Explorar productos activos de todas las comunidades que usan un tag',
  })
  findByTag(@Query() query: ExploreProductsQueryDto) {
    return this.productsService.findByTag(query);
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
        tagIds: {
          type: 'array',
          items: { type: 'integer' },
          example: [1, 3],
          description:
            'Reemplaza por completo los tags. En multipart/form-data puede enviarse como arreglo JSON',
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
