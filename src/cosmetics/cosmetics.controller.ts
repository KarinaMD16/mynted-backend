import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { BANNER_MAX_FILE_SIZE } from './cosmetics.config';
import { CosmeticsService } from './cosmetics.service';
import { CosmeticDto, MyCosmeticsDto } from './dto/cosmetics-response.dto';
import { EquipCosmeticsDto } from './dto/equip-cosmetics.dto';

@ApiTags('cosmetics')
@Controller()
export class CosmeticsController {
  constructor(private readonly cosmeticsService: CosmeticsService) {}

  @Get('cosmetics')
  @ApiOperation({
    summary:
      'Catálogo de cosméticos activos (banners, skins del ganso y marcos), con proOnly. Público',
  })
  @ApiOkResponse({ type: [CosmeticDto] })
  catalog() {
    return this.cosmeticsService.getCatalog();
  }

  // Debe quedar antes de cualquier 'users/:id' con más segmentos; aquí las
  // rutas tienen 3 segmentos, así que no chocan con GET /users/:id.
  @Get('users/me/cosmetics')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Lo que tengo equipado (preferencia, se conserva al vencer Pro) y lo efectivo (lo que se aplica ahora)',
  })
  @ApiOkResponse({ type: MyCosmeticsDto })
  mine(@Req() request: AuthenticatedRequest) {
    return this.cosmeticsService.getMine(request.user.userId);
  }

  @Put('users/me/cosmetics')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Equipar cosméticos. Solo cambia lo que envías; null deja ese tipo en su valor por defecto. Los gratuitos los puede equipar cualquiera; los Pro, solo con Pro vigente',
  })
  @ApiOkResponse({ type: MyCosmeticsDto })
  @ApiNotFoundResponse({
    description: 'El cosmético no existe o está inactivo',
  })
  @ApiForbiddenResponse({
    description: 'El cosmético o el banner propio requieren Pro vigente',
  })
  equip(@Body() dto: EquipCosmeticsDto, @Req() request: AuthenticatedRequest) {
    return this.cosmeticsService.equip(request.user.userId, dto);
  }

  @Put('users/me/banner')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('banner', { limits: { fileSize: BANNER_MAX_FILE_SIZE } }),
  )
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Subir o reemplazar el banner propio (solo Pro). Queda como preferido y se borra el anterior de Cloudinary',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['banner'],
      properties: {
        banner: {
          type: 'string',
          format: 'binary',
          description: 'Imagen o GIF (JPEG, PNG, WEBP o GIF; máximo 8 MB)',
        },
      },
    },
  })
  @ApiOkResponse({ type: MyCosmeticsDto })
  @ApiForbiddenResponse({
    description: 'El banner propio requiere Pro vigente',
  })
  @ApiResponse({
    status: 400,
    description: 'Falta el archivo o no es una imagen válida',
  })
  @ApiResponse({ status: 413, description: 'El archivo supera los 8 MB' })
  setBanner(
    @UploadedFile() banner: Express.Multer.File | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.cosmeticsService.setCustomBanner(request.user.userId, banner);
  }

  @Delete('users/me/banner')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Quitar el banner propio y borrarlo de Cloudinary. No exige Pro; repetirlo no falla',
  })
  @ApiNoContentResponse({ description: 'Banner propio eliminado' })
  async removeBanner(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.cosmeticsService.removeCustomBanner(request.user.userId);
  }
}
