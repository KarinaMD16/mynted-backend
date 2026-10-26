import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
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
}
