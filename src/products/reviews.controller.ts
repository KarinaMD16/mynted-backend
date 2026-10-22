import {
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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
  AuthenticatedRequest,
  OptionalAuthenticatedRequest,
} from '../auth/types/authenticated-request';
import {
  CreateReviewDto,
  GetReviewsQueryDto,
  UpdateReviewDto,
} from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('reviews')
@Controller('products/:id/reviews')
@ApiParam({ name: 'id', type: Number, example: 22 })
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Reseñar un producto comprado (rating 1-5 y comentario opcional). Requiere una compra completada del producto; una reseña por usuario y producto',
  })
  @ApiResponse({ status: 201, description: 'Reseña creada' })
  @ApiResponse({ status: 400, description: 'rating fuera de 1-5' })
  @ApiResponse({
    status: 403,
    description:
      'Es tu propio producto, es un producto de intercambio (aún no se pueden reseñar) o no tienes una compra completada de él',
  })
  @ApiResponse({ status: 404, description: 'Producto no encontrado' })
  @ApiResponse({ status: 409, description: 'Ya reseñaste este producto' })
  create(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateReviewDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reviewsService.create(id, request.user.userId, dto);
  }

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Reseñas de un producto, paginadas (más recientes primero), con promedio y total',
  })
  findAll(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: GetReviewsQueryDto,
    @Req() request: OptionalAuthenticatedRequest,
  ) {
    return this.reviewsService.findByProduct(id, query, request.user?.userId);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Editar mi reseña de este producto' })
  updateMine(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReviewDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reviewsService.updateMine(id, request.user.userId, dto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Borrar mi reseña de este producto' })
  async removeMine(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.reviewsService.removeMine(id, request.user.userId);
  }
}
