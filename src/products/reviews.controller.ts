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
      'No puedes reseñar tu propio producto · Los productos de intercambio todavía no se pueden reseñar · Solo puedes reseñar productos que hayas comprado (se exige una compra con pago completed; failed, pending y refunded no cuentan)',
  })
  @ApiResponse({
    status: 404,
    description:
      'Producto no encontrado (también un borrador ajeno, o un producto borrado del que no tienes una compra completed)',
  })
  @ApiResponse({
    status: 409,
    description:
      'Ya reseñaste este producto (una reseña por usuario y producto, aunque lo hayas comprado varias veces; también si dos peticiones llegan a la vez)',
  })
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
      'Reseñas de un producto, paginadas (más recientes primero), con promedio y total. Sin sesión funciona para productos activos; un producto borrado solo lo ven quienes tienen una compra completed de él',
  })
  @ApiResponse({
    status: 404,
    description:
      'Producto no encontrado, borrador ajeno o producto borrado sin compra completed del usuario',
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
  @ApiOperation({
    summary:
      'Editar mi reseña de este producto. comment: null (o vacío) borra el comentario; si se omite no cambia',
  })
  @ApiResponse({
    status: 400,
    description: 'Sin rating ni comment, o rating fuera de 1-5',
  })
  @ApiResponse({ status: 404, description: 'No has reseñado este producto' })
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
